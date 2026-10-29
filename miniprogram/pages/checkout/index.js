const api = require('../../utils/api');
const ui = require('../../utils/ui');
const MAX_PHOTO_BYTES = 4.5 * 1024 * 1024;

function choosePhoto() {
  return new Promise((resolve, reject) => {
    const fail = error => {
      if (/cancel/i.test(error.errMsg || '')) { resolve(null); return; }
      reject(new Error('无法选择照片，请检查微信相册、相机权限及隐私授权后重试'));
    };
    const imagePicker = () => wx.chooseImage({
      count: 1, sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success(result) {
        const file = result.tempFiles && result.tempFiles[0];
        resolve(file ? { tempFilePath: file.path, size: file.size } : null);
      }, fail
    });
    if (wx.chooseMedia) {
      wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
        success(result) { resolve(result.tempFiles && result.tempFiles[0]); },
        fail(error) {
          if (/not support|not available|not implemented/i.test(error.errMsg || '') && wx.chooseImage) imagePicker();
          else fail(error);
        }
      });
    } else if (wx.chooseImage) { imagePicker(); }
    else { reject(new Error('当前微信版本不支持选择照片，请升级微信')); }
  });
}
function privacyAuthorization() {
  return new Promise((resolve, reject) => {
    if (!wx.requirePrivacyAuthorize) { resolve(); return; }
    wx.requirePrivacyAuthorize({
      success: resolve,
      fail() { reject(new Error('选择照片需要微信隐私授权，请同意后重试')); }
    });
  });
}
function inspectImage(path) {
  return new Promise((resolve, reject) => wx.getImageInfo({
    src: path,
    success: resolve,
    fail() { reject(new Error('无法读取照片，请选择有效的 JPG、PNG、WEBP 或 GIF 图片')); }
  }));
}
function fileSize(path) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().getFileInfo({
    filePath: path, success: result => resolve(result.size),
    fail() { reject(new Error('无法读取照片大小，请重新选择')); }
  }));
}
Page({
  data: {
    id: '', phone: '', record: null, loading: false, busy: false, choosing: false,
    error: '', imagePath: '', imageSize: '', form: { volunteerNote: '' }, accepted: false, completed: false
  },
  onLoad(options) {
    this.setData({ id: options.id || '', phone: options.phone || ui.profile().phone || '' });
    this.load();
  },
  async load() {
    if (!this.data.id || !/^\d{11}$/.test(this.data.phone)) {
      this.setData({ error: '预约信息不完整，请从「我的记录」重新进入签退。' });
      return;
    }
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: '', record: null });
    try {
      const results = await Promise.all([
        api.request('/api/room/bookings', 'GET', { phone: this.data.phone, tab: 'upcoming' }),
        api.request('/api/room/bookings', 'GET', { phone: this.data.phone, tab: 'history' })
      ]);
      if (sequence !== this.sequence) return;
      const record = results[0].concat(results[1]).find(item => item.id === this.data.id);
      if (!record) throw new Error('未找到此手机号的预约，请返回重新查询');
      if (record.status === 'checked_out') { this.setData({ record, completed: true }); return; }
      if (record.status !== 'upcoming') throw new Error('该预约已取消，无法签退');
      if (Date.parse(record.date + 'T' + record.timeSlot + ':00+08:00') > Date.now()) throw new Error('活动开始后才可签退');
      this.setData({ record });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ error: error.message });
    } finally {
      if (sequence === this.sequence) this.setData({ loading: false });
    }
  },
  input: ui.formInput,
  consent: ui.consent,
  privacy: ui.privacy,
  async choose() {
    if (this.data.busy || this.data.choosing || this.data.completed) return;
    this.setData({ choosing: true });
    try {
      await privacyAuthorization();
      const file = await choosePhoto();
      if (!file) return;
      const path = file.tempFilePath || file.path;
      const size = Number(file.size) || await fileSize(path);
      if (size > MAX_PHOTO_BYTES) throw new Error('照片请小于 4.5 MB，可压缩后重新选择');
      const info = await inspectImage(path);
      if (!/^(jpeg|jpg|png|webp|gif)$/i.test(info.type || '')) throw new Error('请选择 JPG、PNG、WEBP 或 GIF 格式的照片');
      this.setData({ imagePath: path, imageSize: (size / 1024 / 1024).toFixed(2) + ' MB' });
    } catch (error) { ui.errorMessage(error); }
    finally { this.setData({ choosing: false }); }
  },
  preview() {
    if (this.data.imagePath) wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath] });
  },
  submit() {
    return ui.run(this, async () => {
      if (this.data.completed || !this.data.record || this.data.error) throw new Error('请确认预约状态后再提交');
      ui.requireConsent(this.data.accepted);
      if (!this.data.imagePath) throw new Error('请选择社区花园志愿服务照片');
      const volunteerNote = this.data.form.volunteerNote.trim();
      if (volunteerNote.length < 5) throw new Error('志愿服务说明请至少填写 5 个字');
      if (!(await ui.confirm('确认提交照片与服务说明，并完成本次活动室签退？'))) return;
      await api.upload('/api/room/bookings/' + encodeURIComponent(this.data.id) + '/checkout', this.data.imagePath, {
        phone: this.data.phone, volunteerNote
      });
      this.setData({ completed: true, imagePath: '', imageSize: '', 'form.volunteerNote': '' });
      ui.success('签退完成');
    });
  },
  records() { wx.switchTab({ url: '/pages/mine/index' }); }
});
