const config = require('../config');
let adminCookie = '';
function rememberCookie(response) {
  const header = response.header || {};
  const cookies = [].concat(header['Set-Cookie'] || header['set-cookie'] || [], response.cookies || []);
  cookies.forEach(value => {
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
function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = config.baseUrl() + path; } catch (error) { reject(error); return; }
    const isAdmin = path.indexOf('/api/admin/') === 0;
    wx.request({
      url, method, data, timeout: 15000,
      header: Object.assign({ 'content-type': 'application/json' }, isAdmin && adminCookie ? { Cookie: adminCookie } : {}),
      success(response) {
        if (isAdmin) rememberCookie(response);
        if (isAdmin && response.statusCode === 401) adminCookie = '';
        try { resolve(decode(response)); } catch (error) { reject(error); }
      },
      fail() { reject(new Error('无法连接服务，请检查网络后重试')); }
    });
  });
}
function upload(path, filePath, formData) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = config.baseUrl() + path; } catch (error) { reject(error); return; }
    wx.uploadFile({
      url, filePath, name: 'volunteerImage', formData, timeout: 30000,
      success(response) { try { resolve(decode(response)); } catch (error) { reject(error); } },
      fail() { reject(new Error('上传失败，请检查网络后重试')); }
    });
  });
}
function asset(path) {
  if (!path) return '';
  try { return config.baseUrl() + path; } catch (error) { return ''; }
}
module.exports = { request, query, upload, asset, clearSession() { adminCookie = ''; } };
