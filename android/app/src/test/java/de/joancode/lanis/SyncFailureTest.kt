package de.joancode.lanis

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncFailureTest {
    private fun failure(status: Int, body: String): SyncFailure = Response.Builder()
        .request(Request.Builder().url("https://lanis.example").build())
        .protocol(Protocol.HTTP_1_1)
        .code(status)
        .message("Request failed")
        .body(body.toResponseBody())
        .build()
        .use { SyncFailure.fromResponse(it) }

    @Test fun passwordChangeChallengePreservesTheSession() {
        val challenge = failure(403, """{"detail":{"code":"password_change_required"}}""")
        assertTrue(challenge.requiresPasswordChange)
        assertFalse(challenge.invalidSession)
    }

    @Test fun ordinaryAuthenticationFailuresStillInvalidateTheSession() {
        assertTrue(failure(401, "").invalidSession)
        assertTrue(failure(403, """{"detail":"Forbidden"}""").invalidSession)
        assertTrue(failure(403, "<html>Forbidden</html>").invalidSession)
        assertFalse(failure(503, "").invalidSession)
    }
}
