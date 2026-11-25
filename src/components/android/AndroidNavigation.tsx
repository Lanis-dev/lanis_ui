import { NavLink } from 'react-router-dom';
import { androidPresentation } from '../../platform/native';
import { useAndroidTabLabels, useAndroidTabs } from '../../platform/androidNavigation';

export interface AndroidNavigationItem {
  id: string;
  name: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}
export default function AndroidNavigation({ items, onSearch }: { basePath: string; items: AndroidNavigationItem[]; onSearch: () => void }) {
  const [tabs] = useAndroidTabs();
  const [showLabels] = useAndroidTabLabels();
  // Preserve saved choices when the school does not offer a selected module.
  const shown = tabs.map(id => items.find(item => item.id === id)).filter((item): item is AndroidNavigationItem => Boolean(item));
  if (!androidPresentation || !shown.length) return null;
  return <nav className="native-navigation md:hidden" aria-label="Hauptnavigation">
    {shown.map(({ id, href, name, icon: Icon }) => {
      const content = <>
        <span className="native-nav-icon"><Icon aria-hidden="true" className="h-6 w-6" /></span>
        {showLabels && <span className="native-nav-label">{name}</span>}
      </>;
      return id === 'search'
        ? <button key={id} type="button" title={name} aria-label={name} className="native-nav-item" onClick={onSearch}>{content}</button>
        : <NavLink key={id} to={href} title={name} aria-label={name} className={({ isActive }) => `native-nav-item ${isActive ? 'native-nav-active' : ''}`}>
          {content}
        </NavLink>;
    })}
  </nav>;
}
