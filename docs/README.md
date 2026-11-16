# Документация БД

## Какие таблицы используются

- `users` — пользователи: логин, хеш пароля, ФИО, телефон, почта и роль.
- `rooms` — помещения для бронирования.
- `requests` — заявки на зал, дата, способ оплаты, статус и отзыв.
- `payments` — учебная запись об отметке оплаты для каждой заявки; фактических платежей сайт не проводит.

## Как связаны таблицы

`users.id` → `requests.user_id` (1:N), `rooms.id` → `requests.room_id` (1:N), `requests.id` → `payments.request_id` (1:0..1).

В проекте используются внешние ключи `FOREIGN KEY`. Они включаются командой `db.pragma('foreign_keys = ON')` в `db.js`.

## Зачем нужен JOIN

Методы `Requests.findAllDetailed`, `Requests.findByUser`, `Requests.findDetailed` в `db.js` объединяют четыре таблицы, чтобы получить заявку вместе с именем клиента, названием комнаты и отметкой об оплате:

```sql
SELECT r.id, u.fio, rm.name, p.status
FROM requests r
JOIN users u ON r.user_id = u.id
JOIN rooms rm ON r.room_id = rm.id
LEFT JOIN payments p ON p.request_id = r.id;
```

## Как восстановить базу

`schema.sql` содержит **только структуру**; он не содержит паролей и персональных данных. Можно создать новую базу через `sqlite3 test.db < docs/schema.sql`. Если запустить `npm start`, `db.js` самостоятельно создаст таблицы и демонстрационные записи в `conf.db`.

Диаграмма находится в `er_diagram.png`. Её редактируемый исходник — `er_diagram.dot`; для пересоздания нужен Graphviz: `dot -Tpng docs/er_diagram.dot -o docs/er_diagram.png`.
