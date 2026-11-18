const frame = document.querySelector('#experiments');
const nav = [...document.querySelectorAll('nav a')];
const standalone = document.querySelector('#standalone');

function selectPage(id) {
  for (const link of nav) {
    if (link.hash === '#' + id) {
      link.setAttribute('aria-current', 'page');
      standalone.href = link.href;
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

frame.addEventListener('load', () => selectPage(frame.contentWindow.location.hash.slice(1) || 'intake'));
window.addEventListener('message', (event) => {
  if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.fileGalaxyPage) {
    selectPage(event.data.fileGalaxyPage);
  }
});

function drawStars() {
  const canvas = document.querySelector('#stars');
  const width = canvas.width = innerWidth;
  const height = canvas.height = innerHeight;
  const ctx = canvas.getContext('2d');
  const haze = ctx.createRadialGradient(width * .74, height * .18, 5, width * .74, height * .18, width * .66);
  haze.addColorStop(0, '#20104a');
  haze.addColorStop(.6, '#0b1029');
  haze.addColorStop(1, '#050615');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, height);
  let seed = 7309;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < Math.min(1200, width * height / 2200); i++) {
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const size = random();
    ctx.fillStyle = size > .92 ? '#fed7ff' : size > .64 ? '#8e98df' : '#494977';
    ctx.fillRect(x, y, size > .87 ? 2 : 1, size > .87 ? 2 : 1);
    if (size > .98) {
      ctx.fillRect(x - 2, y, 6, 1);
      ctx.fillRect(x, y - 2, 1, 6);
    }
  }
}
drawStars();
window.addEventListener('resize', drawStars);
