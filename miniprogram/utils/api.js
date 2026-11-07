const config = require('../config');
let adminCookie = '', adminCsrf = '';
let member = null, loginFlight = null, generation = 0;
const privateFiles = [];
function discardFiles() {
  while (privateFiles.length) {
    const filePath = privateFiles.pop();
    try { wx.getFileSystemManager().unlink({ filePath, fail() {} }); } catch (error) {}
  }
}
function clearMember() { member = null; generation += 1; discardFiles(); }
function user() {
  if (member && member.expiresAt * 1000 <= Date.now()) clearMember();
  return member ? member.user : null;
}
function connectionError(failure, action = '无法连接服务') {
  let url;
  try { url = config.baseUrl(); } catch (error) { return error; }
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
  if (/url not in domain list|not in.*domain|不在.*合法域名/i.test(String(failure && failure.errMsg || ''))) {
    return new Error(local ? '请求被域名校验拦截。请运行 python scripts/dev_miniprogram.py 后重新编译' : '服务域名配置异常，请联系空间管理员');
  }
  return new Error(local ? action + '。请先在电脑启动本地后端（python scripts/dev_miniprogram.py），保持运行后重新加载' : action + '，请检查网络后重试');
}
function rememberCookie(response) {
  const header = response.header || {};
  [].concat(header['Set-Cookie'] || header['set-cookie'] || [], response.cookies || []).forEach(value => {
    const match = String(value).match(/(?:^|,\s*)session=([^;]*)/);
    if (match) adminCookie = match[1] ? 'session=' + match[1] : '';
  });
}
function decode(response) {
  let data = response.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (error) { throw new Error('服务返回异常，请稍后重试'); }
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error((data && data.error) || (response.statusCode === 413 ? '照片过大，请选择小于 5 MB 的照片' : '请求失败，请稍后重试'));
    error.status = response.statusCode;
    throw error;
  }
  return data;
}
function query(params) {
  return Object.keys(params).filter(key => params[key] !== undefined && params[key] !== '')
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key])).join('&');
}
function headers(admin) {
  if (admin) return Object.assign({}, adminCookie ? { Cookie: adminCookie } : {}, adminCsrf ? { 'X-CSRF-Token': adminCsrf } : {});
  return user() ? { Authorization: 'Bearer ' + member.token } : {};
}
function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      if (!/^\/api\//.test(path)) throw new Error('无效的接口地址');
      url = config.baseUrl() + path;
    } catch (error) { reject(error); return; }
    const admin = path.indexOf('/api/admin/') === 0;
    const sentHeaders = headers(admin), sentGeneration = generation;
    wx.request({
      url, method, data, timeout: 15000,
      header: Object.assign({ 'content-type': 'application/json' }, sentHeaders),
      success(response) {
        if (admin) rememberCookie(response);
        if (response.statusCode === 401) {
          if (admin) { adminCookie = ''; adminCsrf = ''; }
          else if (sentGeneration === generation) clearMember();
        }
        try {
          const value = decode(response);
          if (!admin && sentHeaders.Authorization && sentGeneration !== generation) throw new Error('登录状态已变化，请重新加载');
          if (admin && value && value.csrfToken) adminCsrf = value.csrfToken;
          resolve(value);
        } catch (error) { reject(error); }
      },
      fail(error) { reject(connectionError(error)); }
    });
  });
}
function login() {
  if (user()) return Promise.resolve(member.user);
  if (loginFlight) return loginFlight;
  const initial = generation;
  loginFlight = new Promise((resolve, reject) => {
    try { config.baseUrl(); } catch (error) { reject(error); return; }
    wx.login({
      timeout: 10000,
      success(result) {
        if (!result.code) { reject(new Error('微信登录失败，请重试')); return; }
        request('/api/auth/wechat', 'POST', { code: result.code }).then(value => {
          if (initial !== generation) throw new Error('登录已取消，请重试');
          if (!value.token || !value.user || !value.user.id || !Number.isFinite(value.expiresAt) || value.expiresAt * 1000 <= Date.now()) throw new Error('登录服务返回异常');
          if (wx.getStorageSync('yuexiang_profile_owner') !== value.user.id) wx.removeStorageSync('yuexiang_profile');
          wx.setStorageSync('yuexiang_profile_owner', value.user.id);
          member = value;
          generation += 1;
          resolve(member.user);
        }).catch(reject);
      },
      fail() { reject(new Error('微信登录失败，请重试')); }
    });
  }).finally(() => { loginFlight = null; });
  return loginFlight;
}
async function logout() {
  try { if (user()) await request('/api/auth/logout', 'POST'); }
  finally { clearMember(); }
}
function upload(path, filePath, formData) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      if (!/^\/api\/room\/bookings\/[^/]+\/checkout$/.test(path)) throw new Error('无效的上传地址');
      url = config.baseUrl() + path;
      if (!user()) throw new Error('请先微信登录');
    } catch (error) { reject(error); return; }
    const sentGeneration = generation;
    wx.uploadFile({
      url, filePath, name: 'volunteerImage', formData, timeout: 30000, header: headers(false),
      success(response) {
        if (response.statusCode === 401 && sentGeneration === generation) clearMember();
        try {
          const value = decode(response);
          if (sentGeneration !== generation) throw new Error('登录状态已变化，请重新加载');
          resolve(value);
        } catch (error) { reject(error); }
      },
      fail(error) { reject(connectionError(error, '上传失败')); }
    });
  });
}
function downloadPhoto(path, admin = false) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      if (!/^\/static\/uploads\/volunteer\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(path)) throw new Error('无效的照片地址');
      url = config.baseUrl() + path;
      if (admin ? !adminCookie : !user()) throw new Error('请先登录后查看照片');
    } catch (error) { reject(error); return; }
    const sentGeneration = generation;
    wx.downloadFile({ url, header: headers(admin), timeout: 15000,
      success(result) {
        if (result.tempFilePath) privateFiles.push(result.tempFilePath);
        if (result.statusCode !== 200 || (!admin && sentGeneration !== generation)) {
          discardFiles(); reject(new Error('无法查看照片，请重新登录后重试')); return;
        }
        resolve(result.tempFilePath);
      },
      fail(error) { reject(connectionError(error, '照片加载失败')); }
    });
  });
}
function asset(path) {
  if (!path) return '';
  try { return config.baseUrl() + path; } catch (error) { return ''; }
}
module.exports = { request, query, upload, asset, connectionError, user, login, logout, downloadPhoto,
  clearSession() { adminCookie = ''; adminCsrf = ''; discardFiles(); } };
