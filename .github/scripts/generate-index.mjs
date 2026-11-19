import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const assetDirectory = process.argv[2];
if (!assetDirectory) {
  throw new Error('Usage: node .github/scripts/generate-index.mjs <staged site directory>');
}

const root = resolve(assetDirectory);
const indexPath = join(root, 'index.html');

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeMetadata(value) {
  // Preserve semicolon-terminated HTML references, but treat all literal markup as text.
  return escapeHtml(value.trim().replace(/\s+/g, ' '))
    .replace(/&amp;((?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);)/gi, '&$1');
}

function projectMetadata(html) {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const head = markup.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1]
    ?? markup.split(/<body\b/i, 1)[0];
  const metadata = new Map();

  for (const [tag] of head.matchAll(/<meta\b(?:"[^"]*"|'[^']*'|[^"'<>])*>/gi)) {
    const attributes = new Map(
      [...tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map(([, name, double, single, unquoted]) => [name.toLowerCase(), double ?? single ?? unquoted]),
    );
    const name = attributes.get('name')?.toLowerCase();
    const content = attributes.get('content');
    if (name && content && !metadata.has(name)) {
      metadata.set(name, content);
    }
  }

  return {
    title: escapeMetadata(metadata.get('builds-title') || head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || ''),
    description: escapeMetadata(metadata.get('description') || ''),
  };
}

const projects = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name === 'index.html' && entry.parentPath !== root)
  .map(entry => {
    const segments = relative(root, entry.parentPath).split(sep);
    const { title, description } = projectMetadata(readFileSync(join(entry.parentPath, entry.name), 'utf8'));
    return {
      path: segments.join('/'),
      href: './' + segments.map(encodeURIComponent).join('/') + '/',
      title: title || escapeHtml(segments.at(-1)),
      description,
    };
  })
  .sort((left, right) => left.path.localeCompare(right.path, 'en'));

function navLink({ href, title }) {
  return `          <a href="${escapeHtml(href)}"><span aria-hidden="true">▣</span> ${title}</a>`;
}

function projectCard({ href, title, description, path }) {
  const safeHref = escapeHtml(href);
  const details = description || `<code>${escapeHtml(path)}/</code>`;
  return `          <li>
            <article class="project">
              <div class="project-art" aria-hidden="true"><span>✦</span><span>▤</span><span>✧</span></div>
              <div class="project-copy">
                <h3><a href="${safeHref}">${title}</a></h3>
                <p>${details}</p>
                <a class="button project-link" href="${safeHref}">Enter ${title}</a>
              </div>
            </article>
          </li>`;
}

function replaceSection(html, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex === -1 || endIndex < startIndex) {
    throw new Error(`Missing or misplaced directory markers for ${name}`);
  }
  return html.slice(0, startIndex + start.length) + '\n' + content + '\n'
    + '          ' + html.slice(endIndex);
}

let index = readFileSync(indexPath, 'utf8');
index = replaceSection(index, 'project-nav', projects.map(navLink).join('\n'));
index = replaceSection(index, 'project-list',
  projects.length ? projects.map(projectCard).join('\n') : '          <li>No projects listed yet.</li>');
writeFileSync(indexPath, index);
console.log(`Generated Builds index with ${projects.length} project(s).`);
