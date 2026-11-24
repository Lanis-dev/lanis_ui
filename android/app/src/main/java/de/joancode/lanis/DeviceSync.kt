package de.joancode.lanis

import android.content.Context
import androidx.work.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

class SyncFailure(val status: Int = 0) : Exception()

object DeviceSync {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    private val json = "application/json; charset=utf-8".toMediaType()
    private const val PERIODIC = "lanis-background-sync"

    fun validBackend(value: String): Boolean = try {
        val uri = URI(value)
        uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null
    } catch (_: Exception) { false }

    private fun request(backend: String, path: String, token: String = "", body: JSONObject? = null, method: String = "GET"): JSONObject {
        require(validBackend(backend))
        val builder = Request.Builder().url(backend.trimEnd('/') + path).header("Accept", "application/json")
        if (token.isNotEmpty()) builder.header("X-Session-Token", token)
        if (method != "GET") builder.method(method, (body ?: JSONObject()).toString().toRequestBody(json))
        client.newCall(builder.build()).execute().use { response ->
            if (!response.isSuccessful) throw SyncFailure(response.code)
            val source = response.body?.source() ?: throw SyncFailure()
            if (source.request(8L * 1024 * 1024 + 1)) throw SyncFailure() // Bound untrusted server responses.
            return JSONObject(source.readUtf8())
        }
    }
    // Serialize native requests without locking out vault readers or writers.
    private val networkLock = Any()

    private data class Session(val backend: String, val refresh: String, val access: String, val expiresAt: Long) {
        fun owns(state: JSONObject): Boolean {
            val session = state.optJSONObject("session") ?: return false
            return backend == state.optString("backend") && refresh == session.optString("auth_refresh_token") &&
                !session.has("__lanis_account_deletion_recovery")
        }

        companion object {
            fun read(state: JSONObject): Session? {
                val session = state.optJSONObject("session") ?: return null
                val refresh = session.optString("auth_refresh_token")
                if (refresh.isEmpty() || session.has("__lanis_account_deletion_recovery")) return null
                return Session(state.optString("backend"), refresh, session.optString("auth_access_token"),
                    session.optLong("auth_expires_at"))
            }
        }
    }

    private class SessionChanged : Exception()

    private fun updateOwned(context: Context, owner: Session, update: (JSONObject) -> Boolean) {
        synchronized(NativeStore.lock) {
            val current = NativeStore.read(context)
            if (!owner.owns(current)) throw SessionChanged()
            if (update(current)) NativeStore.write(context, current)
        }
    }

    private fun accessToken(context: Context, expected: Session, forceRefresh: Boolean = false): Session {
        val state = NativeStore.read(context)
        if (!expected.owns(state)) throw SessionChanged()
        val session = Session.read(state) ?: throw SessionChanged()
        if (forceRefresh && session != expected && session.access.isNotEmpty()) return session
        if (!forceRefresh && session.expiresAt > System.currentTimeMillis() + 300_000 && session.access.isNotEmpty()) {
            return session
        }
        val result = request(session.backend, "/auth/refresh", body = JSONObject().put("refresh_token", session.refresh), method = "POST")
        val refreshed = session.copy(access = result.getString("access_token"),
            expiresAt = System.currentTimeMillis() + result.getLong("expires_in") * 1000)
        synchronized(NativeStore.lock) {
            val current = NativeStore.read(context)
            if (!session.owns(current)) throw SessionChanged()
            val latest = Session.read(current) ?: throw SessionChanged()
            // A foreground refresh may have completed while this request was in flight.
            if (latest != session) return latest
            current.getJSONObject("session").put("auth_access_token", refreshed.access)
                .put("auth_expires_at", refreshed.expiresAt.toString())
            NativeStore.write(context, current)
        }
        return refreshed
    }

    fun sync(context: Context): Boolean = synchronized(networkLock) sync@{
        val snapshot = NativeStore.read(context)
        var session = Session.read(snapshot) ?: return@sync true
        val initialTimestamp = snapshot.optLong("lastUpdated")
        val initialPreferences = snapshot.optJSONObject("widgetPreferences")?.toString()
        try {
            session = accessToken(context, session)
            val path = "/stundenplan/view?view_mode=rolling&plan_mode=personal"
            val data = try { request(session.backend, path, session.access) }
            catch (error: SyncFailure) {
                if (error.status != 401) throw error
                session = accessToken(context, session, forceRefresh = true)
                request(session.backend, path, session.access)
            }
            if (!data.optBoolean("success") || data.optJSONArray("days") == null) throw SyncFailure()
            updateOwned(context, session) { current ->
                if (current.optLong("lastUpdated") != initialTimestamp) return@updateOwned false
                current.put("timetable", data).put("lastUpdated", System.currentTimeMillis()).put("syncError", "")
                true
            }
            // Settings and push failures must leave the cached timetable available.
            val preferences = runCatching { request(session.backend, "/settings/preferences", session.access) }.getOrNull()
            if (preferences != null) updateOwned(context, session) { current ->
                current.optJSONObject("widgetPreferences")?.toString() == initialPreferences &&
                    WidgetAppearance.fromAccount(current, preferences)
            }
            val push = NativeStore.read(context)
            if (!session.owns(push)) throw SessionChanged()
            val fcmToken = push.optString("fcmToken")
            val binding = push.optString("pushBinding")
            if (push.optBoolean("notificationsEnabled") && fcmToken.isNotEmpty() && binding.isNotEmpty()) {
                val registration = runCatching {
                    request(session.backend, "/notifications/android", session.access,
                        JSONObject().put("token", fcmToken).put("binding", binding)
                            .put("previous_token", push.optString("registeredToken").ifEmpty { null }), "POST")
                }
                updateOwned(context, session) { current ->
                    if (current.optString("pushBinding") != binding) return@updateOwned false
                    // Unregister needs the actual registered token if opt-out happened during the request.
                    if (registration.isSuccess) current.put("registeredToken", fcmToken).put("pushError", "")
                    else current.put("pushError", "Benachrichtigungen konnten nicht registriert werden. Prüfe die Server-Einrichtung.")
                    true
                }
            }
            synchronized(NativeStore.lock) {
                if (session.owns(NativeStore.read(context))) WidgetTickWorker.schedule(context)
            }
            Widgets.updateAll(context)
            true
        } catch (_: SessionChanged) {
            true
        } catch (error: Exception) {
            val invalidSession = error is SyncFailure && (error.status == 401 || error.status == 403)
            synchronized(NativeStore.lock) {
                val current = NativeStore.read(context)
                if (!session.owns(current)) return@sync true
                if (invalidSession && Session.read(current) != session) return@sync true
                if (invalidSession) {
                    NativeStore.clear(context)
                    NativeStore.write(context, JSONObject().put("syncError", "Bitte melde dich erneut an, um deine Daten zu aktualisieren."))
                    cancel(context)
                    context.getSystemService(android.app.NotificationManager::class.java).cancelAll()
                } else if (current.optLong("lastUpdated") == initialTimestamp) {
                    current.put("syncError", "Aktualisierung nicht möglich. Gespeicherte Daten bleiben verfügbar; neuere Änderungen können fehlen.")
                    NativeStore.write(context, current)
                }
            }
            Widgets.updateAll(context)
            false
        }
    }

    fun unregister(context: Context) = synchronized(networkLock) {
        val state = NativeStore.read(context)
        val registered = state.optString("registeredToken")
        if (registered.isEmpty() || state.optBoolean("notificationsEnabled")) return@synchronized
        val session = Session.read(state) ?: return@synchronized
        val binding = state.getString("pushBinding")
        val access = accessToken(context, session)
        request(access.backend, "/notifications/android", access.access,
            JSONObject().put("token", registered).put("binding", binding), "DELETE")
        updateOwned(context, access) { current ->
            if (current.optString("registeredToken") != registered || current.optString("pushBinding") != binding) {
                return@updateOwned false
            }
            current.remove("registeredToken")
            true
        }
    }
    fun schedule(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val periodic = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, periodic)
    }
    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("lanis-sync-now", ExistingWorkPolicy.KEEP, request)
    }
    fun cancel(context: Context) {
        LessonProgress.stop(context)
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        WorkManager.getInstance(context).cancelUniqueWork("lanis-sync-now")
        WorkManager.getInstance(context).cancelUniqueWork("lanis-widget-tick")
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        if (DeviceSync.sync(applicationContext)) Result.success()
        else if (runAttemptCount < 3) Result.retry() else Result.failure()
    } catch (_: Exception) { if (runAttemptCount < 3) Result.retry() else Result.failure() }
}
