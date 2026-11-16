// Форматы из темы «Регулярные выражения в валидации проекта».
export const TYPES = ['конференц-зал', 'переговорная', 'опенспейс'];
export const METHODS = ['При очном посещении', 'Перевод по СБП'];
export const STATUSES = ['Новая', 'Мероприятие назначено', 'Завершено', 'Отклонена'];
export const PAYMENT_STATUSES = ['Не оплачено', 'Оплачено'];

export function validateRegistration(form) {
  const errors = [];
  if (!/^[A-Za-z0-9]{6,30}$/.test(form.login)) errors.push('Логин: латинские буквы и цифры, от 6 до 30 символов.');
  if (form.password.length < 8) errors.push('Пароль: минимум 8 символов.');
  if (!/^[А-Яа-яЁё\s]+$/.test(form.fio) || form.fio.length > 100) errors.push('ФИО: только кириллица и пробелы.');
  if (!/^8\(\d{3}\)\d{3}-\d{2}-\d{2}$/.test(form.phone)) errors.push('Телефон: формат 8(999)123-45-67.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errors.push('Некорректный email.');
  return errors;
}

export function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateRequest(form, roomExists, today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  if (!roomExists) errors.push('Выберите существующее помещение.');
  if (!isRealDate(form.date_start)) errors.push('Введите правильную дату.');
  else if (form.date_start < today) errors.push('Дата мероприятия не может быть в прошлом.');
  if (!METHODS.includes(form.payment)) errors.push('Выберите способ оплаты из списка.');
  return errors;
}
