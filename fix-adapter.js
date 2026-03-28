const fs = require('fs');
const f = '/tmp/conflict-check/gitnexus/src/core/lbug/lbug-adapter.ts';
let c = fs.readFileSync(f, 'utf8');

// Fix the upsert function - add Section case before TABLES_WITH_EXPORTED
const oldUpsert = `        } else if (label === 'Folder') {
          query = \`MERGE (n:Folder {id: \${escapeValue(properties.id)}}) SET n.name = \${escapeValue(properties.name)}, n.filePath = \${escapeValue(properties.filePath)}\`;
        } else if (TABLES_WITH_EXPORTED.has(label)) {`;

const newUpsert = `        } else if (label === 'Folder') {
          query = \`MERGE (n:Folder {id: \${escapeValue(properties.id)}}) SET n.name = \${escapeValue(properties.name)}, n.filePath = \${escapeValue(properties.filePath)}\`;
        } else if (label === 'Section') {
          const descPart = properties.description ? \`, n.description = \${escapeValue(properties.description)}\` : '';
          query = \`MERGE (n:Section {id: \${escapeValue(properties.id)}}) SET n.name = \${escapeValue(properties.name)}, n.filePath = \${escapeValue(properties.filePath)}, n.startLine = \${properties.startLine || 0}, n.endLine = \${properties.endLine || 0}, n.level = \${properties.level || 1}, n.content = \${escapeValue(properties.content || '')}$\{descPart}\`;
        } else if (TABLES_WITH_EXPORTED.has(label)) {`;

if (c.includes(oldUpsert)) {
  c = c.replace(oldUpsert, newUpsert);
  fs.writeFileSync(f, c);
  console.log('Done - upsert Section case added');
} else {
  console.log('Pattern not found - checking file...');
  // Show context around the area
  const lines = c.split('\n');
  const idx = lines.findIndex((l) => l.includes("} else if (label === 'Folder')"));
  if (idx >= 0) {
    console.log('Found Folder case at line', idx + 1);
    for (let i = idx; i < idx + 10; i++) console.log(lines[i]);
  }
}
