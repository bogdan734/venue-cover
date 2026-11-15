import { api } from '@/lib/api';
import { isOpen } from '@/lib/portal';
import type { Program } from '@/lib/types';

// `/embed/<CODE>.js`: one line on a venue's own website adds a button that opens the program's portal in a new tab. A new
// tab rather than a frame: browsers withhold cookies from a frame on another site, which would break signing in and
// paying, and the renter sees the program's own address before typing anything.
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const code = /^([A-Za-z0-9]{3,6})\.js$/.exec((await params).file)?.[1]?.toUpperCase();
  const { programs } = await api<{ programs: Program[] }>('operator', '/v1/programs');
  const program = programs.find((p) => p.code === code && isOpen(p));
  if (!program) {
    return new Response('/* no open portal by that code */', {
      status: 404,
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    });
  }
  const values = JSON.stringify({
    code: program.code,
    name: program.name,
    brand: program.theme?.brand ?? '#20408f',
  });
  const script = `(function () {
  var p = ${values};
  var s = document.currentScript;
  if (!s) return;
  var origin = new URL(s.src).origin;
  var box = document.createElement('div');
  box.setAttribute('style', 'display:inline-flex;flex-direction:column;gap:6px;font-family:system-ui,-apple-system,sans-serif');
  var a = document.createElement('a');
  a.href = origin + '/p/' + p.code;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = s.getAttribute('data-label') || 'Insure your event';
  a.setAttribute('style', 'display:inline-flex;align-items:center;justify-content:center;padding:12px 20px;border-radius:8px;background:' + p.brand + ';color:#fff;font-weight:600;font-size:15px;line-height:1.2;text-decoration:none');
  var note = document.createElement('span');
  note.textContent = 'Event liability in a few minutes, from ' + p.name;
  note.setAttribute('style', 'font-size:12px;color:#5c667f');
  box.appendChild(a);
  box.appendChild(note);
  var target = s.getAttribute('data-target') && document.getElementById(s.getAttribute('data-target'));
  if (target) target.appendChild(box);
  else s.parentNode.insertBefore(box, s.nextSibling);
})();
`;
  return new Response(script, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
