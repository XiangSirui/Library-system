const api = require('../../utils/api');
const ui = require('../../utils/ui');
const SLOT_LABELS = { free: '可预约', booked: '已预约', closed: '未开放', past: '已结束' };

function durationOptions(slots, start) {
  const first = Number(String(start).split(':')[0]);
  const available = new Set(slots.filter(slot => slot.status === 'free').map(slot => slot.time));
  const result = [];
  for (let hours = 1; hours <= 3; hours += 1) {
    const hour = first + hours - 1;
    const time = (hour < 10 ? '0' : '') + hour + ':00';
    if (!available.has(time)) break;
    result.push(hours);
  }
  return result;
}

Page({
  data: {
    days: [], date: '', weekday: '', slots: [], timeSlot: '', durations: [], durationLabels: [],
    durationIndex: 0, duration: 0, endTime: '', loading: false, busy: false, error: '',
    form: { name: '', phone: '', purpose: '', attendees: '10' }, accepted: false, result: null
  },
  onLoad() {
    const profile = ui.profile();
    this.savedPhone = profile.phone || '';
    this.setData({ 'form.name': profile.name, 'form.phone': profile.phone });
  },
  onShow() {
    const profile = ui.profile();
    if ((profile.phone || '') !== this.savedPhone) {
      this.savedPhone = profile.phone || '';
      this.setData({ 'form.name': profile.name || '', 'form.phone': profile.phone || '', accepted: false });
    }
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const calendar = await api.request('/api/room/calendar');
      if (sequence !== this.sequence) return;
      const days = calendar.days || [];
      const day = days.find(item => item.date === this.data.date) || days.find(item => item.freeSlots > 0) || days[0];
      this.setData({ days });
      this.selectDay(day, true);
    } catch (error) {
      if (sequence === this.sequence) this.setData({ error: error.message, days: [], slots: [], timeSlot: '', duration: 0 });
    } finally {
      if (sequence === this.sequence) this.setData({ loading: false });
    }
  },
  selectDay(day, preserve) {
    if (!day) {
      this.setData({ date: '', weekday: '', slots: [], timeSlot: '', durations: [], durationLabels: [], duration: 0, endTime: '' });
      return;
    }
    const slots = day.slots.map(slot => Object.assign({}, slot, { label: SLOT_LABELS[slot.status] || slot.status }));
    const oldTime = preserve && this.data.date === day.date ? this.data.timeSlot : '';
    const timeSlot = slots.some(slot => slot.time === oldTime && slot.status === 'free') ? oldTime : '';
    this.setData({ date: day.date, weekday: day.weekday, slots });
    this.selectTime(timeSlot);
  },
  dateTap(event) {
    if (this.data.busy) return;
    this.selectDay(this.data.days.find(day => day.date === event.currentTarget.dataset.date), false);
    this.setData({ result: null });
  },
  slotTap(event) {
    if (this.data.busy) return;
    const slot = this.data.slots.find(item => item.time === event.currentTarget.dataset.time);
    if (slot && slot.status === 'free') this.selectTime(slot.time);
  },
  selectTime(timeSlot) {
    const durations = timeSlot ? durationOptions(this.data.slots, timeSlot) : [];
    const oldDuration = this.data.duration;
    const duration = durations.indexOf(oldDuration) >= 0 ? oldDuration : (durations.indexOf(2) >= 0 ? 2 : durations[0] || 0);
    const endHour = Number(timeSlot.split(':')[0]) + duration;
    this.setData({
      timeSlot, durations, durationLabels: durations.map(value => value + ' 小时'),
      duration, durationIndex: Math.max(0, durations.indexOf(duration)),
      endTime: duration ? (endHour < 10 ? '0' : '') + endHour + ':00' : ''
    });
  },
  durationChange(event) {
    const index = Number(event.detail.value);
    const duration = this.data.durations[index];
    if (!duration || this.data.busy) return;
    const hour = Number(this.data.timeSlot.split(':')[0]) + duration;
    this.setData({ durationIndex: index, duration, endTime: (hour < 10 ? '0' : '') + hour + ':00' });
  },
  input: ui.formInput,
  consent: ui.consent,
  privacy: ui.privacy,
  submit() {
    return ui.run(this, async () => {
      const value = {
        name: this.data.form.name.trim(), phone: this.data.form.phone.trim(),
        purpose: this.data.form.purpose.trim(), attendees: Number(this.data.form.attendees),
        date: this.data.date, timeSlot: this.data.timeSlot, duration: this.data.duration
      };
      ui.validateContact(value);
      ui.requireConsent(this.data.accepted);
      if (!value.purpose) throw new Error('请填写活动用途');
      if (!Number.isInteger(value.attendees) || value.attendees < 1 || value.attendees > 30) throw new Error('预计人数须为 1–30 人');
      if (!value.date || !value.timeSlot || !value.duration) throw new Error('请选择可预约时段');
      // 提交前重新检查空闲状态，避免停留页面期间时段发生变化。
      const calendar = await api.request('/api/room/calendar');
      const day = (calendar.days || []).find(item => item.date === value.date);
      if (!day || durationOptions(day.slots, value.timeSlot).indexOf(value.duration) < 0) {
        this.setData({ days: calendar.days || [] });
        this.selectDay(day, false);
        throw new Error('该时段已发生变化，请重新选择');
      }
      const record = await api.request('/api/room/bookings', 'POST', value);
      const old = ui.profile();
      ui.saveProfile({ name: value.name, phone: value.phone, card: old.phone === value.phone ? old.card : '' });
      this.savedPhone = value.phone;
      this.setData({ result: record, timeSlot: '', duration: 0, durations: [], durationLabels: [], endTime: '', 'form.purpose': '' });
      await this.load();
      ui.success('预约成功');
    });
  },
  records() { wx.switchTab({ url: '/pages/mine/index' }); },
  onShareAppMessage() { return { title: '阅享空间 · 预约社区共享活动室', path: '/pages/room/index' }; }
});
