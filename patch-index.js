import fs from 'fs';
import path from 'path';

const distDir = path.join(process.cwd(), 'dist');
const indexPath = path.join(distDir, 'index.html');
const fallbackPath = path.join(distDir, '404.html');

if (!fs.existsSync(indexPath)) {
  console.error('Error: dist/index.html not found! Make sure to run vite build first.');
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

// Match the compiled JS script tag: <script type="module" crossorigin src="./assets/index-xxxx.js"></script>
const jsRegex = /<script\s+type="module"\s+crossorigin\s+src="\.?\/([^"]+)"\s*><\/script>/i;
// Match the compiled CSS link tag: <link rel="stylesheet" crossorigin href="./assets/index-xxxx.css">
const cssRegex = /<link\s+rel="stylesheet"\s+crossorigin\s+href="\.?\/([^"]+)"\s*\/?>/i;

const jsMatch = html.match(jsRegex);
const cssMatch = html.match(cssRegex);

if (!jsMatch) {
  console.error('Error: Could not find compiled JS script tag in index.html');
  process.exit(1);
}

const jsFile = jsMatch[1]; // e.g. "assets/index-xxx.js"
const cssFile = cssMatch ? cssMatch[1] : null; // e.g. "assets/index-xxx.css"

console.log('Extracted assets:');
console.log('JS:', jsFile);
console.log('CSS:', cssFile);

// Remove the matched static tags
html = html.replace(jsRegex, '');
if (cssMatch) {
  html = html.replace(cssRegex, '');
}

// Remove any existing manual <base> dynamic script if it is there
const existingBaseScriptRegex = /<script>\s*\(function\(\)\s*\{\s*var\s+baseHref\s*=\s*'\/';[\s\S]*?\}\)\(\);\s*<\/script>/i;
html = html.replace(existingBaseScriptRegex, '');

// Create the dynamic loader code
let loaderScript = `
    <script>
      (function() {
        var basePath = '/';
        if (window.location.hostname.endsWith('.github.io')) {
          var pathSegments = window.location.pathname.split('/');
          if (pathSegments.length > 1 && pathSegments[1]) {
            basePath = '/' + pathSegments[1] + '/';
          }
        }
        
        // Dynamically insert CSS
        ${cssFile ? `
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.crossOrigin = 'anonymous';
        link.href = basePath + '${cssFile}';
        document.head.appendChild(link);
        ` : ''}
        
        // Dynamically insert JS
        var script = document.createElement('script');
        script.type = 'module';
        script.crossOrigin = 'anonymous';
        script.src = basePath + '${jsFile}';
        document.head.appendChild(script);
      })();
    </script>
`;

// Insert the dynamic loader script into the <head> of the HTML (before </head>)
html = html.replace('</head>', `${loaderScript}\n  </head>`);

// Write back to index.html and 404.html
fs.writeFileSync(indexPath, html, 'utf8');
console.log('Successfully patched dist/index.html');

fs.writeFileSync(fallbackPath, html, 'utf8');
console.log('Successfully copied patched HTML to dist/404.html');
