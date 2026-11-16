import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let server, base, db, folder, userCookie, adminCookie, firstId, secondId;
const day = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

before(async () => {
  folder = mkdtempSync(join(tmpdir(), 'conference-test-'));
  process.env.DB_FILE = join(folder, 'test.db');
  process.env.SESSION_SECRET = 'local-test-secret';
  const { default: app } = await import('../server.js');
  ({ default: db } = await import('../db.js'));
  server = await new Promise(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) db.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

async function send(path, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  const response = await fetch(base + path, {
    method, headers, redirect: 'manual',
    body: body ? new URLSearchParams(body).toString() : undefined
  });
  return { status: response.status, location: response.headers.get('location'),
    cookie: response.headers.get('set-cookie')?.split(';')[0], html: await response.text() };
}

test('каталог доступен гостю, Bootstrap отдаётся локально', async () => {
  const rooms = await send('/rooms');
  assert.equal(rooms.status, 200);
  assert.match(rooms.html, /Горизонт/);
  assert.match(rooms.html, /bootstrap.min.css/);
  assert.equal((await send('/css/bootstrap.min.css')).status, 200);
});

test('страницы с заявками не доступны без входа', async () => {
  const page = await send('/dashboard');
  assert.equal(page.status, 302);
  assert.equal(page.location, '/login');
});

test('регистрация проверяет поля и не допускает одинаковый логин', async () => {
  const wrong = await send('/register', { method: 'POST', body: {
    login: 'aa', password: '123', fio: 'Test', phone: '123', email: 'bad'
  }});
  assert.equal(wrong.status, 422);
  assert.match(wrong.html, /Логин:/);
  const form = { login: 'petrivan', password: 'Password123!', fio: 'Петров Иван',
    phone: '8(999)222-44-55', email: 'petr@example.com' };
  assert.equal((await send('/register', { method: 'POST', body: form })).status, 302);
  assert.equal((await send('/register', { method: 'POST', body: form })).status, 422);
});

test('вход пользователя и проверка пароля', async () => {
  assert.equal((await send('/login', { method: 'POST', body: { login: 'petrivan', password: 'wrong' } })).status, 401);
  const response = await send('/login', { method: 'POST', body: { login: 'petrivan', password: 'Password123!' } });
  assert.equal(response.status, 302);
  assert.equal(response.location, '/dashboard');
  userCookie = response.cookie;
  assert.ok(userCookie);
});

test('заявка и оплата сохраняются вместе', async () => {
  const form = { room_id: '1', date_start: day, payment: 'При очном посещении' };
  assert.equal((await send('/create', { method: 'POST', cookie: userCookie, body: form })).status, 302);
  assert.equal((await send('/create', { method: 'POST', cookie: userCookie, body: form })).status, 302);
  const rows = db.prepare('SELECT id FROM requests WHERE room_id = 1 AND date_start = ? ORDER BY id').all(day);
  assert.equal(rows.length, 2);
  [firstId, secondId] = rows.map(row => row.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payments WHERE request_id IN (?, ?)').get(firstId, secondId).count, 2);
  assert.match((await send('/dashboard', { cookie: userCookie })).html, /Горизонт/);
});

test('обычный пользователь не может менять статусы', async () => {
  assert.equal((await send('/admin', { cookie: userCookie })).status, 403);
  assert.equal((await send('/admin/payment', { method: 'POST', cookie: userCookie, body: { id: firstId, status: 'Оплачено' } })).status, 403);
});

test('администратор подтверждает только одну заявку на зал и дату', async () => {
  const login = await send('/login', { method: 'POST', body: { login: 'Conf2027', password: 'Demo77' } });
  assert.equal(login.status, 302);
  adminCookie = login.cookie;
  assert.equal(login.location, '/admin');
  assert.equal((await send('/admin', { method: 'POST', cookie: adminCookie,
    body: { id: firstId, status: 'Мероприятие назначено' } })).status, 302);
  assert.equal((await send('/admin', { method: 'POST', cookie: adminCookie,
    body: { id: secondId, status: 'Мероприятие назначено' } })).status, 302);
  assert.equal(db.prepare('SELECT status FROM requests WHERE id = ?').get(firstId).status, 'Мероприятие назначено');
  assert.equal(db.prepare('SELECT status FROM requests WHERE id = ?').get(secondId).status, 'Новая');
});

test('администратор отмечает оплату', async () => {
  assert.equal((await send('/admin/payment', { method: 'POST', cookie: adminCookie,
    body: { id: firstId, status: 'Оплачено' } })).status, 302);
  const detail = await send('/request/' + firstId, { cookie: userCookie });
  assert.equal(detail.status, 200);
  assert.match(detail.html, /Оплачено/);
});

test('отзыв разрешён после завершения и только один раз', async () => {
  assert.equal((await send('/review/' + firstId, { method: 'POST', cookie: userCookie,
    body: { review: 'Все понравилось' } })).status, 400);
  await send('/admin', { method: 'POST', cookie: adminCookie,
    body: { id: firstId, status: 'Завершено' } });
  assert.equal((await send('/review/' + firstId, { method: 'POST', cookie: userCookie,
    body: { review: 'Всё понравилось' } })).status, 302);
  assert.equal((await send('/review/' + firstId, { method: 'POST', cookie: userCookie,
    body: { review: 'Повторный отзыв' } })).status, 400);
  assert.match((await send('/request/' + firstId, { cookie: userCookie })).html, /Всё понравилось/);
});

test('запрещён просмотр чужой заявки', async () => {
  const other = await send('/login', { method: 'POST', body: { login: 'student', password: 'Student123!' } });
  assert.equal((await send('/request/' + firstId, { cookie: other.cookie })).status, 403);
});
