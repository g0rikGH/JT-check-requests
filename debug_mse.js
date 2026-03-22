import Database from 'better-sqlite3';
const db = new Database('database.sqlite');

const latestTask = db.prepare('SELECT id FROM tasks ORDER BY id DESC LIMIT 1').get();
const mseSupplier = db.prepare("SELECT id FROM suppliers WHERE name LIKE '%MSE%'").get();

if (mseSupplier) {
  const mseOffers = db.prepare(`
    SELECT o.*, p.article_norm as part_article_norm, p.brand as part_brand
    FROM offers o
    JOIN parts p ON o.part_id = p.id
    WHERE o.task_id = ? AND o.supplier_id = ?
    LIMIT 5
  `).all(latestTask.id, mseSupplier.id);
  console.log("MSE Offers:", mseOffers);
}
