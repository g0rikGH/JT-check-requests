import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: ReturnType<typeof Database> | null = null;

export async function getDb() {
  if (db) return db;

  db = new Database(path.join(__dirname, 'database.sqlite'));
  
  // Включаем поддержку внешних ключей
  db.pragma('foreign_keys = ON');

  initDb(db);
  return db;
}

function initDb(database: ReturnType<typeof Database>) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL,
      article_norm TEXT NOT NULL,
      name TEXT,
      UNIQUE(brand, article_norm)
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS reference_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      brand TEXT NOT NULL,
      article_norm TEXT NOT NULL,
      original_article TEXT NOT NULL,
      name TEXT,
      quantity INTEGER DEFAULT 1,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(task_id, brand, article_norm)
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      part_id INTEGER NOT NULL,
      original_article TEXT NOT NULL,
      replacement_article TEXT,
      replacement_norm TEXT,
      replacement_status TEXT DEFAULT 'pending',
      price REAL NOT NULL,
      moq INTEGER,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
      FOREIGN KEY(part_id) REFERENCES parts(id) ON DELETE CASCADE
    );
  `);

  try {
    database.exec('ALTER TABLE offers ADD COLUMN replacement_norm TEXT');
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    database.exec("ALTER TABLE offers ADD COLUMN replacement_status TEXT DEFAULT 'pending'");
  } catch (e) {
    // Ignore if column already exists
  }

  const count = database.prepare('SELECT COUNT(*) as count FROM suppliers').get() as { count: number };
  if (count.count === 0) {
    const insert = database.prepare('INSERT INTO suppliers (name) VALUES (?)');
    insert.run('Поставщик А');
    insert.run('Поставщик Б');
  }
}
