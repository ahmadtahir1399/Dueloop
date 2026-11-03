// M9: on every route change the new page content fades in with a 4 px rise (CSS, enter only; none with reduced motion).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
