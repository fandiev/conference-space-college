import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { User, Room, Requests, Payments } from './db.js';
import { TYPES, METHODS, STATUSES, PAYMENT_STATUSES, validateRegistration, validateRequest } from './validation.js';

const folder = dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('view engine', 'ejs');
app.set('views', join(folder, 'views'));
app.use(express.static(join(folder, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 2 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

// 20 минут без действий — сессия закрывается.
app.use((req, res, next) => {
  if (req.session.user && req.session.lastActivity && Date.now() - req.session.lastActivity > 20 * 60 * 1000) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  if (req.session.user) req.session.lastActivity = Date.now();
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.status(403).render('error', { message: 'Нет доступа к панели администратора.' });
  next();
}
function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function flash(req, text) {
  req.session.flash = text;
}
function auth(res, mode, data = {}, status = 200) {
  return res.status(status).render('auth', {
    mode, form: data.form || {}, errors: data.errors || [], error: data.error || null
  });
}

app.get('/', (req, res) => res.redirect('/rooms'));
app.get('/rooms', (req, res) => res.render('rooms', { rooms: Room.findAll(), types: TYPES, selected: '' }));
app.get('/rooms/type/:type', (req, res) => {
  if (!TYPES.includes(req.params.type)) return res.status(404).render('error', { message: 'Категория не найдена.' });
  res.render('rooms', { rooms: Room.findAll(req.params.type), types: TYPES, selected: req.params.type });
});

app.get('/register', (req, res) => auth(res, 'register'));
app.post('/register', (req, res) => {
  const form = {
    login: clean(req.body.login), password: typeof req.body.password === 'string' ? req.body.password : '',
    fio: clean(req.body.fio), phone: clean(req.body.phone), email: clean(req.body.email)
  };
  const errors = validateRegistration(form);
  if (User.findByLogin(form.login)) errors.push('Логин уже занят.');
  if (errors.length) return auth(res, 'register', { form, errors }, 422);
  try {
    User.create(form);
  } catch (err) {
    if (err.code?.startsWith('SQLITE_CONSTRAINT')) return auth(res, 'register', { form, errors: ['Логин уже занят.'] }, 422);
    throw err;
  }
  flash(req, 'Регистрация успешна. Теперь войдите.');
  res.redirect('/login');
});

app.get('/login', (req, res) => auth(res, 'login'));
app.post('/login', (req, res, next) => {
  const login = clean(req.body.login);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = User.findByLogin(login);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return auth(res, 'login', { form: { login }, error: 'Неверный логин или пароль.' }, 401);
  }
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.user = { id: user.id, login: user.login, fio: user.fio, role: user.role };
    req.session.lastActivity = Date.now();
    res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
  });
});
app.post('/logout', requireAuth, (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('requests_list', { requests: Requests.findByUser(req.session.user.id), isAdmin: false, statuses: STATUSES });
});
app.get('/create', requireAuth, (req, res) => {
  res.render('create_request', { rooms: Room.findAll(), methods: METHODS, form: {}, errors: [], today: new Date().toISOString().slice(0, 10) });
});
app.post('/create', requireAuth, (req, res) => {
  const form = { room_id: clean(req.body.room_id), date_start: clean(req.body.date_start), payment: clean(req.body.payment) };
  const roomId = Number(form.room_id);
  const room = Number.isSafeInteger(roomId) && roomId > 0 ? Room.findById(roomId) : null;
  const errors = validateRequest(form, !!room);
  if (!errors.length && Requests.isBusy(roomId, form.date_start)) errors.push('На эту дату помещение уже занято.');
  if (errors.length) return res.status(422).render('create_request', {
    rooms: Room.findAll(), methods: METHODS, form, errors, today: new Date().toISOString().slice(0, 10)
  });
  Requests.create(req.session.user.id, roomId, form.date_start, form.payment);
  flash(req, 'Заявка отправлена администратору.');
  res.redirect('/dashboard');
});

app.get('/admin', requireAdmin, (req, res) => {
  res.render('requests_list', { requests: Requests.findAllDetailed(), isAdmin: true, statuses: STATUSES });
});
app.post('/admin', requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const status = clean(req.body.status);
  const booking = Number.isSafeInteger(id) && id > 0 ? Requests.findDetailed(id) : null;
  if (!booking) return res.status(404).render('error', { message: 'Заявка не найдена.' });
  if (!STATUSES.includes(status)) return res.status(400).render('error', { message: 'Недопустимый статус.' });
  if (['Мероприятие назначено', 'Завершено'].includes(status) && Requests.isBusy(booking.room_id, booking.date_start, id)) {
    flash(req, 'Нельзя подтвердить заявку: помещение уже занято.');
    return res.redirect('/admin');
  }
  Requests.updateStatus(id, status);
  flash(req, 'Статус заявки обновлён.');
  res.redirect('/admin');
});
app.post('/admin/payment', requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const status = clean(req.body.status);
  if (!Number.isSafeInteger(id) || id < 1 || !Requests.findDetailed(id)) return res.status(404).render('error', { message: 'Заявка не найдена.' });
  if (!PAYMENT_STATUSES.includes(status)) return res.status(400).render('error', { message: 'Недопустимый статус оплаты.' });
  Payments.updateStatus(id, status);
  flash(req, 'Отметка об оплате обновлена.');
  res.redirect('/request/' + id);
});

app.get('/request/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const booking = Number.isSafeInteger(id) && id > 0 ? Requests.findDetailed(id) : null;
  if (!booking) return res.status(404).render('error', { message: 'Заявка не найдена.' });
  const isOwner = booking.user_id === req.session.user.id;
  if (!isOwner && req.session.user.role !== 'admin') return res.status(403).render('error', { message: 'Вы не можете смотреть чужую заявку.' });
  res.render('request_detail', { booking, isOwner, paymentStatuses: PAYMENT_STATUSES });
});
app.post('/review/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const booking = Number.isSafeInteger(id) && id > 0 ? Requests.findDetailed(id) : null;
  if (!booking) return res.status(404).render('error', { message: 'Заявка не найдена.' });
  if (booking.user_id !== req.session.user.id) return res.status(403).render('error', { message: 'Доступ запрещён.' });
  if (booking.status !== 'Завершено' || booking.review !== null) {
    return res.status(400).render('error', { message: 'Оставить отзыв можно один раз после завершения мероприятия.' });
  }
  const review = clean(req.body.review);
  if (review.length < 3 || review.length > 1000) return res.status(422).render('error', { message: 'Отзыв: от 3 до 1000 символов.' });
  const result = Requests.addReview(id, req.session.user.id, review);
  if (!result.changes) return res.status(400).render('error', { message: 'Отзыв уже отправлен.' });
  flash(req, 'Спасибо за отзыв.');
  res.redirect('/request/' + id);
});

app.use((req, res) => res.status(404).render('error', { message: 'Страница не найдена.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { message: 'Ошибка сервера.' });
});

export default app;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Сервер запущен: http://localhost:' + port));
}
