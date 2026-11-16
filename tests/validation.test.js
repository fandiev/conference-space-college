import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistration, validateRequest, isRealDate } from '../validation.js';

test('регистрация пропускает правильные данные', () => {
  assert.deepEqual(validateRegistration({
    login: 'student55', password: 'Password123', fio: 'Иванов Иван',
    phone: '8(999)123-45-67', email: 'ivan@example.com'
  }), []);
});

test('регистрация отклоняет неправильные значения', () => {
  const errors = validateRegistration({ login: 'аб', password: '123', fio: 'John Smith', phone: '123', email: 'xxx' });
  assert.equal(errors.length, 5);
});

test('неверные даты отклоняются', () => {
  assert.equal(isRealDate('2027-02-30'), false);
  assert.equal(isRealDate('2027-12-31'), true);
});

test('при создании заявки нельзя выбрать прошедшую дату или неверную оплату', () => {
  assert.equal(validateRequest({ date_start: '2025-01-01', payment: 'Подарок' }, true, '2026-11-16').length, 2);
});
