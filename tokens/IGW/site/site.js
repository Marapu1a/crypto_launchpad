// Visual fiction only: no requests, uploads, files, wallet calls or storage.
const strip = document.querySelector('.fridge-strip');
const message = strip.querySelector('.fridge-message');
const percent = strip.querySelector('.fridge-percent');
const fill = strip.querySelector('.fridge-fill');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const failures = [
  'UPLOAD FAILED. MOM TURNED OFF THE WI-FI.',
  'UPLOAD FAILED. THE DOG UNPLUGGED IT.',
  'UPLOAD FAILED. WASHBOARD ALIGNED NORTH–SOUTH.'
];
let visible = false, elapsed = 0, previous = null, frame = null;
function render() {
  const time = elapsed % 20000;
  const failed = time >= 11700 && time < 16700;
  const reconnect = time >= 16700;
  const progress = reconnect ? 0 : Math.min(99, Math.floor(99 * Math.max(0, Math.min((time - 1200) / 8000, 1))));
  const text = reconnect ? 'RECONNECTING TO FRIDGE…' : failed ? failures[Math.floor(elapsed / 20000) % failures.length] : time < 1200 ? 'CONNECTING TO YOUR FRIDGE…' : 'UPLOADING YOUR NUDES. PLEASE DON’T CLOSE THE FRIDGE…';
  if (message.textContent !== text) message.textContent = text;
  const value = progress + '%';
  if (percent.textContent !== value) percent.textContent = value;
  strip.classList.toggle('is-failed', failed);
  strip.classList.toggle('is-uploading', time >= 1200 && time < 11700);
  // Preserve the text sequence without moving graphics for reduced motion.
  fill.style.transform = 'scaleX(' + (reduced.matches ? 0 : progress / 100) + ')';
}
function tick(now) {
  frame = null;
  if (!visible || document.hidden) { previous = null; return; }
  if (previous !== null) elapsed += now - previous;
  previous = now;
  render();
  frame = requestAnimationFrame(tick);
}
function resume() {
  previous = null;
  if (visible && !document.hidden && frame === null) frame = requestAnimationFrame(tick);
}
// This decorative loop must not repeatedly interrupt screen-reader speech.
message.removeAttribute('role');
render();
document.addEventListener('visibilitychange', resume);
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .75;
    resume();
  }, {threshold: [0, .75]});
  observer.observe(strip);
} else { visible = true; resume(); }

const contactDialog = document.querySelector('.contact-dialog');
const contactButton = document.querySelector('.contact-open');
contactButton.addEventListener('click', () => contactDialog.showModal());
contactDialog.querySelector('.contact-close').addEventListener('click', () => contactDialog.close());
contactDialog.addEventListener('click', event => {
  if (event.target !== contactDialog) return;
  const rect = contactDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) contactDialog.close();
});
contactDialog.addEventListener('close', () => contactButton.focus({preventScroll:true}));
