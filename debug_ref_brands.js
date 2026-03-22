import Database from 'better-sqlite3';
const db = new Database('database.sqlite');

const latestTask = db.prepare('SELECT id FROM tasks ORDER BY id DESC LIMIT 1').get();
const refBrands = db.prepare(`
  SELECT brand, COUNT(*) as count FROM reference_items WHERE task_id = ? GROUP BY brand
`).all(latestTask.id);
console.log("Reference Brands for Task 2:", refBrands);
