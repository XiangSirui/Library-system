'use strict';

// Run with: node --test tests/miniprogram.test.js
// Real mini-program modules run in isolated VMs with a small wx adapter.
// No server, real database, network, or WeChat account is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wxHarness() {
  const storage = new Map();
  const calls = { requests: [], uploads: [], toasts: [], modals: [], navigation: [] };
  const wx = {
    request(options) { calls.requests.push(options); },
    uploadFile(options) { calls.uploads.push(options); },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, copy(value)); },
    removeStorageSync(key) { storage.delete(key); },
    showToast(options) { calls.toasts.push(options); },
    showModal(options) {
      calls.modals.push(options);
      if (options.success) options.success({ confirm: true, cancel: false });
    },
    navigateTo(options) { calls.navigation.push({ type: 'to', ...options }); },
    switchTab(options) { calls.navigation.push({ type: 'tab', ...options }); },
    navigateBack() { calls.navigation.push({ type: 'back' }); },
    setNavigationBarTitle() {},
    stopPullDownRefresh() {},
    previewImage() {}
  };
  return { wx, calls, storage };
}
function loadModule(relative, dependencies, harness) {
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, wx: harness.wx, console,
    require(name) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) throw new Error('Unexpected dependency: ' + name);
      return dependencies[name];
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, { filename: relative });
  return module.exports;
}
function setData(patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const fields = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = this.data;
    fields.slice(0, -1).forEach(field => { target = target[field]; });
    target[fields.at(-1)] = value;
  });
}
function pageHarness(name, responder) {
  const harness = wxHarness();
  const ui = loadModule('miniprogram/utils/ui.js', {}, harness);
  const requests = [];
  const api = {
    async request(endpoint, method = 'GET', data = {}) {
      const call = { endpoint, method, data: copy(data) };
      requests.push(call);
      if (!responder) throw new Error('Unexpected API call: ' + endpoint);
      return responder(call);
    },
    query(data) { return Object.keys(data).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key])).join('&'); },
    asset(value) { return value ? 'https://service.example' + value : ''; }
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/pages', name, 'index.js'), 'utf8'), {
    wx: harness.wx, console, Page(value) { definition = value; },
    require(request) {
      if (request === '../../utils/api') return api;
      if (request === '../../utils/ui') return ui;
      throw new Error('Unexpected dependency: ' + request);
    }
  }, { filename: 'pages/' + name + '/index.js' });
  const page = { ...definition, data: copy(definition.data), setData };
  return { ...harness, page, ui, requests };
}
function apiHarness(config = { baseUrl: () => 'https://service.example' }) {
  const harness = wxHarness();
  return { ...harness, api: loadModule('miniprogram/utils/api.js', { '../config': config }, harness) };
}
function response(data, statusCode = 200, extra = {}) { return { data, statusCode, ...extra }; }
function validContact() { return { name: '测试读者', phone: '13800138000', card: 'C-01' }; }
function reviewForm() { return { ...validContact(), rating: 4, content: '这本书让我看见了社区中不同的人与故事。' }; }

test('API preserves GET filters and JSON response without using browser APIs', async () => {
  const { api, calls } = apiHarness();
  const pending = api.request('/api/books', 'GET', { category: '文学', search: '活着' });
  const request = calls.requests[0];
  assert.equal(request.url, 'https://service.example/api/books');
  assert.equal(request.method, 'GET');
  assert.deepEqual(copy(request.data), { category: '文学', search: '活着' });
  assert.equal(request.header['content-type'], 'application/json');
  request.success(response([{ id: 'b1' }]));
  assert.deepEqual(copy(await pending), [{ id: 'b1' }]);
});

test('admin session cookie is returned only to admin endpoints and removed on 401', async () => {
  const { api, calls } = apiHarness();
  let pending = api.request('/api/admin/login', 'POST', { username: 'operator', password: 'test-only' });
  calls.requests.at(-1).success(response({ username: 'operator' }, 200, { cookies: ['session=signed-value; HttpOnly; Path=/'] }));
  await pending;

  pending = api.request('/api/admin/stats');
  assert.equal(calls.requests.at(-1).header.Cookie, 'session=signed-value');
  calls.requests.at(-1).success(response({ totalBooks: 16 }));
  await pending;

  pending = api.request('/api/books');
  assert.equal(calls.requests.at(-1).header.Cookie, undefined);
  calls.requests.at(-1).success(response([]));
  await pending;

  pending = api.request('/api/admin/me');
  calls.requests.at(-1).success(response({ error: '登录已过期' }, 401));
  await assert.rejects(pending, error => error.status === 401 && error.message === '登录已过期');
  pending = api.request('/api/admin/stats');
  assert.equal(calls.requests.at(-1).header.Cookie, undefined);
  calls.requests.at(-1).success(response({}));
  await pending;
});

test('Set-Cookie header fallback, logout expiry, and explicit session clearing work', async () => {
  const { api, calls } = apiHarness();
  async function login() {
    const pending = api.request('/api/admin/login', 'POST', {});
    calls.requests.at(-1).success(response({}, 200, { cookies: [], header: { 'Set-Cookie': 'session=header-value; Path=/; HttpOnly' } }));
    await pending;
  }
  await login();
  let pending = api.request('/api/admin/logout', 'POST');
  assert.equal(calls.requests.at(-1).header.Cookie, 'session=header-value');
  calls.requests.at(-1).success(response({ ok: true }, 200, { header: { 'set-cookie': 'session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/' } }));
  await pending;
  pending = api.request('/api/admin/me');
  assert.equal(calls.requests.at(-1).header.Cookie, undefined);
  calls.requests.at(-1).success(response({}));
  await pending;
  await login();
  api.clearSession();
  pending = api.request('/api/admin/me');
  assert.equal(calls.requests.at(-1).header.Cookie, undefined);
  calls.requests.at(-1).success(response({}));
  await pending;
});

test('configuration failures and request network failures reject cleanly', async () => {
  const unavailable = apiHarness({ baseUrl() { throw new Error('service not configured'); } });
  await assert.rejects(unavailable.api.request('/api/books'), /service not configured/);
  assert.equal(unavailable.calls.requests.length, 0);
  const { api, calls } = apiHarness();
  const pending = api.request('/api/books');
  calls.requests[0].fail({ errMsg: 'request:fail timeout' });
  await assert.rejects(pending, /无法连接服务/);
});

test('photo upload sends the expected multipart field and parses JSON', async () => {
  const { api, calls } = apiHarness();
  const data = { phone: '13800138000', volunteerNote: '社区花园志愿浇水' };
  const pending = api.upload('/api/room/bookings/r1/checkout', 'wxfile://photo.jpg', data);
  const upload = calls.uploads[0];
  assert.equal(upload.name, 'volunteerImage');
  assert.equal(upload.filePath, 'wxfile://photo.jpg');
  assert.equal(upload.url, 'https://service.example/api/room/bookings/r1/checkout');
  assert.deepEqual(copy(upload.formData), data);
  upload.success(response(JSON.stringify({ id: 'r1', status: 'checked_out' })));
  assert.deepEqual(copy(await pending), { id: 'r1', status: 'checked_out' });
});

test('uploads reject business errors, oversized files, malformed JSON, and network errors', async () => {
  const { api, calls } = apiHarness();
  let pending = api.upload('/checkout', 'photo.jpg', {});
  calls.uploads.at(-1).success(response('{"error":"活动开始后方可签退"}', 400));
  await assert.rejects(pending, error => error.status === 400 && /活动开始/.test(error.message));
  pending = api.upload('/checkout', 'photo.jpg', {});
  calls.uploads.at(-1).success(response('{}', 413));
  await assert.rejects(pending, error => error.status === 413 && /5 MB/.test(error.message));
  pending = api.upload('/checkout', 'photo.jpg', {});
  calls.uploads.at(-1).success(response('<html>gateway error</html>', 502));
  await assert.rejects(pending, /服务返回异常/);
  pending = api.upload('/checkout', 'photo.jpg', {});
  calls.uploads.at(-1).fail({ errMsg: 'uploadFile:fail' });
  await assert.rejects(pending, /上传失败/);
});

test('contact validation, consent, and local profile preserve only contact fields', () => {
  const harness = wxHarness();
  const ui = loadModule('miniprogram/utils/ui.js', {}, harness);
  assert.deepEqual(copy(ui.profile()), { name: '', phone: '', card: '' });
  assert.throws(() => ui.validateContact({ name: ' ', phone: '13800138000' }), /姓名/);
  for (const phone of ['', '1380013800', '138001380000', '13800abc000']) {
    assert.throws(() => ui.validateContact({ name: '读者', phone }), /手机号/);
  }
  assert.doesNotThrow(() => ui.validateContact(validContact()));
  assert.throws(() => ui.requireConsent(false), /隐私/);
  ui.saveProfile({ ...validContact(), password: 'must-not-persist', admin: true });
  assert.deepEqual(copy(ui.profile()), validContact());
  assert.equal(Object.keys(harness.storage.get('yuexiang_profile')).length, 3);
});

test('book borrowing is single-flight and shows the returned pickup code and due date', async () => {
  const gate = deferred();
  const { page, calls, requests, storage } = pageHarness('book', ({ endpoint, method }) => {
    if (endpoint === '/api/borrows' && method === 'POST') return gate.promise;
    if (endpoint === '/api/books/b1') return { id: 'b1', title: '测试图书', available: 1 };
    if (endpoint === '/api/books/b1/reviews') return { reviews: [], count: 0, avgRating: 0 };
    throw new Error('Unexpected endpoint: ' + endpoint);
  });
  page.bookId = 'b1';
  page.setData({ form: validContact(), accepted: true });
  const first = page.borrow();
  const second = page.borrow();
  assert.equal(page.data.busy, true);
  assert.equal(requests.filter(call => call.method === 'POST').length, 1);
  gate.resolve({ code: 'JY-TEST', dueDate: '2026-11-29' });
  await Promise.all([first, second]);
  assert.equal(page.data.busy, false);
  assert.equal(storage.get('yuexiang_profile').phone, validContact().phone);
  assert.match(calls.modals.at(-1).content, /JY-TEST/);
  assert.match(calls.modals.at(-1).content, /2026-11-29/);
  assert.equal(page.data.book.available, 1);
});

test('book borrowing does not call the server without valid contact and consent', async () => {
  const { page, requests, calls } = pageHarness('book');
  page.bookId = 'b1';
  page.setData({ form: validContact(), accepted: false });
  await page.borrow();
  assert.equal(requests.length, 0);
  assert.match(calls.toasts.at(-1).title, /隐私/);
  assert.equal(page.data.busy, false);
});

test('ineligible readers cannot submit a review', async () => {
  const { page, requests, calls } = pageHarness('review', () => ({ canReview: false, reason: '借阅过本书后才能发表读后感' }));
  page.bookId = 'b1';
  page.setData({ form: reviewForm(), accepted: true });
  await page.submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, '/api/reviews/eligibility');
  assert.equal(requests[0].data.book_id, 'b1');
  assert.equal(page.data.eligibility.canReview, false);
  assert.match(calls.toasts.at(-1).title, /借阅过本书/);
});

test('editing a review targets its escaped ID with PUT after eligibility is confirmed', async () => {
  const { page, requests, calls } = pageHarness('review', ({ endpoint }) => endpoint === '/api/reviews/eligibility' ? { canReview: true } : { id: 'review/1', status: 'pending' });
  page.bookId = 'b1';
  page.reviewId = 'review/1';
  page.setData({ form: reviewForm(), accepted: true });
  await page.submit();
  const mutation = requests.find(call => call.method === 'PUT');
  assert.equal(mutation.endpoint, '/api/reviews/review%2F1');
  assert.equal(mutation.data.rating, 4);
  assert.equal(mutation.data.phone, validContact().phone);
  assert.equal(requests.some(call => call.method === 'POST'), false);
  assert.equal(calls.navigation.at(-1).type, 'back');
});

test('review content length is validated before any eligibility or write request', async () => {
  const { page, requests, calls } = pageHarness('review');
  page.bookId = 'b1';
  page.setData({ form: { ...reviewForm(), content: '短评' }, accepted: true });
  await page.submit();
  assert.equal(requests.length, 0);
  assert.match(calls.toasts.at(-1).title, /10–500/);
});

test('room duration choices stop at closed, occupied, and missing hours', () => {
  const { page } = pageHarness('room');
  const day = { date: '2026-11-01', weekday: '周日', slots: [
    { time: '08:00', status: 'free' }, { time: '09:00', status: 'closed' },
    { time: '10:00', status: 'free' }, { time: '11:00', status: 'free' },
    { time: '12:00', status: 'booked' }, { time: '13:00', status: 'free' }
  ] };
  page.selectDay(day, false);
  page.selectTime('08:00');
  assert.deepEqual(copy(page.data.durations), [1]);
  assert.equal(page.data.endTime, '09:00');
  page.selectTime('10:00');
  assert.deepEqual(copy(page.data.durations), [1, 2]);
  page.durationChange({ detail: { value: 1 } });
  assert.equal(page.data.endTime, '12:00');
  page.slotTap({ currentTarget: { dataset: { time: '12:00' } } });
  assert.equal(page.data.timeSlot, '10:00');
  page.selectTime('13:00');
  assert.deepEqual(copy(page.data.durations), [1]);
});

test('room booking refreshes availability before mutation and refuses stale slots', async () => {
  const { page, requests, calls } = pageHarness('room', () => ({ days: [{
    date: '2026-11-01', weekday: '周日', slots: [{ time: '10:00', status: 'booked' }]
  }] }));
  page.setData({ form: { ...validContact(), purpose: '读书会', attendees: '10' }, accepted: true, date: '2026-11-01', timeSlot: '10:00', duration: 1 });
  await page.submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, '/api/room/calendar');
  assert.equal(requests.some(call => call.method === 'POST'), false);
  assert.equal(page.data.timeSlot, '');
  assert.match(calls.toasts.at(-1).title, /时段已发生变化/);
});

test('room booking validates capacity and returns a successful reservation receipt', async () => {
  const calendar = { days: [{ date: '2026-11-01', weekday: '周日', freeSlots: 2, slots: [{ time: '10:00', status: 'free' }, { time: '11:00', status: 'free' }] }] };
  const { page, requests } = pageHarness('room', ({ endpoint }) => endpoint === '/api/room/calendar' ? calendar : { id: 'room1', code: 'HD-TEST', status: 'upcoming' });
  page.setData({ form: { ...validContact(), purpose: '读书会', attendees: '31' }, accepted: true, date: '2026-11-01', timeSlot: '10:00', duration: 2 });
  await page.submit();
  assert.equal(requests.length, 0);
  page.setData({ 'form.attendees': '10' });
  await page.submit();
  const mutation = requests.find(call => call.method === 'POST');
  assert.equal(mutation.endpoint, '/api/room/bookings');
  assert.equal(mutation.data.duration, 2);
  assert.equal(mutation.data.attendees, 10);
  assert.equal(page.data.result.code, 'HD-TEST');
});

test('my records never requests unfiltered records or queries without consent', async () => {
  const { page, requests, calls } = pageHarness('mine');
  await page.load();
  assert.equal(requests.length, 0);
  page.setData({ phone: validContact().phone });
  await page.load();
  assert.equal(requests.length, 0);
  await page.query();
  assert.equal(requests.length, 0);
  assert.match(calls.toasts.at(-1).title, /隐私/);
});

test('changing phone clears old records immediately and ignores late responses', async () => {
  const oldGate = deferred();
  const newGate = deferred();
  const oldPhone = '13800138000';
  const newPhone = '13900139000';
  const { page, requests } = pageHarness('mine', ({ data }) => data.phone === oldPhone ? oldGate.promise : newGate.promise);
  page.setData({ phone: oldPhone, queriedPhone: oldPhone, accepted: true, records: [{ id: 'cached-old' }] });
  const oldRequest = page.load();
  page.phoneInput({ detail: { value: newPhone } });
  assert.deepEqual(copy(page.data.records), []);
  assert.equal(page.data.queriedPhone, '');
  const newQuery = page.query();
  assert.equal(requests.at(-1).data.phone, newPhone);
  newGate.resolve([{ id: 'new-record', status: 'returned', dueDate: '2026-11-01' }]);
  await newQuery;
  oldGate.resolve([{ id: 'old-record', status: 'borrowed', dueDate: '2026-01-01' }]);
  await oldRequest;
  assert.equal(page.data.records.length, 1);
  assert.equal(page.data.records[0].id, 'new-record');
  assert.equal(page.data.queriedPhone, newPhone);
  assert.equal(page.data.loading, false);
});

test('my record mutations include the queried phone and cannot run after changing identity', async () => {
  const { page, requests } = pageHarness('mine', ({ method }) => method === 'POST' ? { status: 'returned' } : []);
  const phone = validContact().phone;
  page.setData({ phone, queriedPhone: phone, records: [{ id: 'borrow/1', status: 'borrowed' }] });
  await page.action({ currentTarget: { dataset: { id: 'borrow/1', action: 'return' } } });
  const mutation = requests.find(call => call.method === 'POST');
  assert.equal(mutation.endpoint, '/api/borrows/borrow%2F1/return');
  assert.equal(mutation.data.phone, phone);
  page.phoneInput({ detail: { value: '13900139000' } });
  const count = requests.length;
  await page.action({ currentTarget: { dataset: { id: 'borrow/1', action: 'return' } } });
  assert.equal(requests.length, count);
});
