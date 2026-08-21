import type { Child } from 'hono/jsx';

// Desktop-only server-rendered shell. Inline style on purpose: no assets
// binding, no build step, nothing to cache — the console is a bare tool.
const STYLE = `
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; color: #1a1a1a; background: #fafafa; }
  header { background: #1d3557; color: #fff; padding: 10px 20px; display: flex; align-items: center; gap: 20px; }
  header a { color: #cde; text-decoration: none; margin-right: 12px; }
  header a:hover { color: #fff; }
  header .user { margin-left: auto; font-size: 12px; color: #aac; }
  header form { display: inline; }
  header button { background: none; border: 1px solid #557; color: #cde; border-radius: 4px; padding: 2px 10px; cursor: pointer; }
  main { padding: 20px; max-width: 1600px; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #eef2f7; position: sticky; top: 0; }
  tr:hover td { background: #f2f6fb; }
  td a { color: inherit; text-decoration: none; display: block; }
  .filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; align-items: end; }
  .filters label { display: flex; flex-direction: column; font-size: 12px; color: #555; }
  .filters input, .filters select { padding: 4px 6px; border: 1px solid #bbb; border-radius: 4px; min-width: 120px; }
  .filters button, .btn { background: #1d3557; color: #fff; border: 0; border-radius: 4px; padding: 6px 14px; cursor: pointer; text-decoration: none; display: inline-block; }
  .bignum { font-size: 64px; font-weight: 700; margin: 6px 0; }
  .muted { color: #777; font-size: 12px; }
  .pager { margin-top: 12px; display: flex; gap: 14px; }
  pre { background: #f4f4f4; padding: 10px; overflow-x: auto; border: 1px solid #ddd; }
  .truncate { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .denied { color: #a33; }
  .warning { color: #a33; background: #fdf0f0; border: 1px solid #e5b8b8; border-radius: 4px; padding: 8px 12px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .empty { text-align: center; color: #777; padding: 40px 0; }
  input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
    outline: 2px solid #1d3557; outline-offset: 1px;
  }
  /* The default navy outline above is invisible against the header's own
     navy background — override to a light color for anything focusable in it. */
  header a:focus-visible, header button:focus-visible {
    outline: 2px solid #fff; outline-offset: 1px;
  }
`;

export function Layout(props: { title: string; user?: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>{props.title} — foodbox admin</title>
        <style>{STYLE}</style>
      </head>
      <body>
        <header>
          <strong>foodbox admin</strong>
          <nav>
            <a href="/">Home</a>
            <a href="/events">Client events</a>
          </nav>
          {props.user ? (
            <span class="user">
              {props.user}{' '}
              <form method="post" action="/logout">
                <button type="submit">Log out</button>
              </form>
            </span>
          ) : null}
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
