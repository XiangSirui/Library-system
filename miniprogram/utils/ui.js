const api = require('./api');
function errorMessage(error) { wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none', duration: 3000 }); }
async function run(page, action) {
  if (page.data.busy) return;
  page.setData({ busy: true });
  try { return await action(); } catch (error) { errorMessage(error); }
  finally { page.setData({ busy: false }); }
}
function confirm(content, title = '请确认') {
  return new Promise(resolve => wx.showModal({ title, content, confirmColor: '#315e46', success: result => resolve(result.confirm), fail: () => resolve(false) }));
}
function success(title) { wx.showToast({ title, icon: 'success' }); }
function profile() { const user = api.user(); return user && wx.getStorageSync('yuexiang_profile_owner') === user.id ? wx.getStorageSync('yuexiang_profile') || { name: '', phone: '', card: '' } : { name: '', phone: '', card: '' }; }
function saveProfile(value) { const user = api.user(); if (!user) return; wx.setStorageSync('yuexiang_profile_owner', user.id); wx.setStorageSync('yuexiang_profile', { name: value.name || '', phone: value.phone || '', card: value.card || '' }); }
function validateContact(value) {
  if (!String(value.name || '').trim()) throw new Error('请填写姓名');
  if (!/^\d{11}$/.test(String(value.phone || ''))) throw new Error('请输入 11 位手机号');
}
function requireConsent(accepted) { if (!accepted) throw new Error('请先阅读并同意隐私说明'); }
function formInput(event) { this.setData({ ['form.' + event.currentTarget.dataset.field]: event.detail.value }); }
function privacy() { wx.navigateTo({ url: '/pages/privacy/index' }); }
function consent(event) { this.setData({ accepted: event.detail.value.indexOf('yes') !== -1 }); }
function preview(event) { const url = event.currentTarget.dataset.url; if (url) wx.previewImage({ current: url, urls: [url] }); }
const statusLabels = { borrowed: '借阅中', returned: '已归还', upcoming: '待使用 / 待签退', cancelled: '已取消', checked_out: '已签退', pending: '待审核', approved: '已发布', rejected: '待修改' };
function records(items) { return items.map(item => Object.assign({}, item, { statusLabel: item.overdue ? '已逾期' : statusLabels[item.status] || item.status })); }
module.exports = { errorMessage, run, confirm, success, profile, saveProfile, validateContact, requireConsent, formInput, privacy, consent, preview, records };
