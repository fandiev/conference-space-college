import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = dirname(fileURLToPath(import.meta.url));
const db = new Database(process.env.DB_FILE || join(folder, 'conf.db'));
db.pragma('foreign_keys = ON');

// Структура таблиц повторяется в docs/schema.sql.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    fio TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0)
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    date_start TEXT NOT NULL,
    payment TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Новая',
    review TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Не оплачено',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
  );
`);

// Примеры для демонстрации. Добавляются один раз, когда таблица пуста.
if (db.prepare('SELECT COUNT(*) AS amount FROM users').get().amount === 0) {
  const insert = db.prepare('INSERT INTO users (login, password, fio, phone, email, role) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('student', bcrypt.hashSync('Student123!', 10), 'Иванов Иван', '8(999)123-45-67', 'student@example.com', 'user');
  insert.run('Conf2027', bcrypt.hashSync(process.env.DEMO_ADMIN_PASSWORD || 'Demo77', 10), 'Администратор', '8(999)000-00-00', 'admin@example.com', 'admin');
}
if (db.prepare('SELECT COUNT(*) AS amount FROM rooms').get().amount === 0) {
  const insert = db.prepare('INSERT INTO rooms (name, type, capacity) VALUES (?, ?, ?)');
  insert.run('Конференц-зал «Горизонт»', 'конференц-зал', 25);
  insert.run('Конференц-зал «Центральный»', 'конференц-зал', 50);
  insert.run('Переговорная №1', 'переговорная', 8);
  insert.run('Переговорная №2', 'переговорная', 12);
  insert.run('Опенспейс', 'опенспейс', 18);
}

// SQL-запросы находятся в методах моделей, а не в server.js.
class UserModel {
  findByLogin(login) {
    return db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  }
  create({ login, password, fio, phone, email }) {
    return db.prepare('INSERT INTO users (login, password, fio, phone, email) VALUES (?, ?, ?, ?, ?)')
      .run(login, bcrypt.hashSync(password, 10), fio, phone, email);
  }
}

class RoomModel {
  findAll(type) {
    return type ? db.prepare('SELECT * FROM rooms WHERE type = ? ORDER BY id').all(type)
      : db.prepare('SELECT * FROM rooms ORDER BY id').all();
  }
  findById(id) {
    return db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  }
}

// JOIN объединяет 4 таблицы: requests, users, rooms, payments.
const query = `
  SELECT r.*, u.login AS user_login, u.fio AS user_fio,
    u.phone AS user_phone, u.email AS user_email,
    rm.name AS room_name, rm.type AS room_type, rm.capacity AS room_capacity,
    p.status AS payment_status
  FROM requests r
  JOIN users u ON r.user_id = u.id
  JOIN rooms rm ON r.room_id = rm.id
  LEFT JOIN payments p ON p.request_id = r.id
`;

class RequestsModel {
  findByUser(userId) {
    return db.prepare(query + ' WHERE r.user_id = ? ORDER BY r.id DESC').all(userId);
  }
  findAllDetailed() {
    return db.prepare(query + ' ORDER BY r.id DESC').all();
  }
  findDetailed(id) {
    return db.prepare(query + ' WHERE r.id = ?').get(id);
  }
  isBusy(roomId, day, exceptId = 0) {
    return !!db.prepare(`SELECT id FROM requests WHERE room_id = ? AND date_start = ? AND id != ?
      AND status IN ('Мероприятие назначено', 'Завершено') LIMIT 1`).get(roomId, day, exceptId);
  }
  create(userId, roomId, date, payment) {
    // Заявка и запись об оплате создаются вместе.
    return db.transaction(() => {
      const info = db.prepare('INSERT INTO requests (user_id, room_id, date_start, payment) VALUES (?, ?, ?, ?)')
        .run(userId, roomId, date, payment);
      db.prepare('INSERT INTO payments (request_id) VALUES (?)').run(info.lastInsertRowid);
      return info.lastInsertRowid;
    })();
  }
  updateStatus(id, status) {
    return db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, id);
  }
  addReview(id, userId, review) {
    return db.prepare(`UPDATE requests SET review = ? WHERE id = ? AND user_id = ?
      AND status = 'Завершено' AND review IS NULL`).run(review, id, userId);
  }
}

class PaymentModel {
  updateStatus(requestId, status) {
    return db.prepare("UPDATE payments SET status = ?, updated_at = datetime('now') WHERE request_id = ?")
      .run(status, requestId);
  }
}

export const User = new UserModel();
export const Room = new RoomModel();
export const Requests = new RequestsModel();
export const Payments = new PaymentModel();
export default db;
