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
