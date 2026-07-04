/**
 * 活动室预约 · 日历选择器（前台）
 */
(function () {
  const BOOKING_DAYS = 14;
  let calendarData = null;
  let selectedDate = null;
  let selectedSlot = null;
  let onProceedCallback = null;

  function initRoomCalendar(onProceed) {
    onProceedCallback = onProceed;
    document.getElementById('roomCalendarProceed')?.addEventListener('click', () => {
      if (!selectedDate || !selectedSlot) return;
      closeModal('roomCalendarModal');
      onProceedCallback(selectedDate, selectedSlot);
    });
  }

  async function openRoomCalendar() {
    selectedDate = null;
    selectedSlot = null;
    try {
      calendarData = await apiRequest('/api/room/calendar');
      renderCalendarGrid();
      hideCalendarDetail();
      openModal('roomCalendarModal');
    } catch (err) {
      showToast(err.message || '加载日历失败', 'error');
    }
  }

  function renderCalendarGrid() {
    const grid = document.getElementById('roomCalendarGrid');
    if (!calendarData?.days?.length) {
      grid.innerHTML = '<p class="room-calendar-empty">暂无可用日期</p>';
      return;
    }

    const start = calendarData.days[0];
    const end = calendarData.days[calendarData.days.length - 1];
    document.getElementById('roomCalendarRange').textContent =
      `${start.displayMonth}月${start.displayDay}日 — ${end.displayMonth}月${end.displayDay}日`;

    grid.innerHTML = calendarData.days.map(day => {
      const mini = day.slots.map(s =>
        `<span class="room-mini-slot ${s.status}" title="${s.time}"></span>`
      ).join('');
      const cls = [
        'room-cal-day',
        day.isToday ? 'today' : '',
        day.isFull ? 'full' : '',
        selectedDate === day.date ? 'selected' : '',
      ].filter(Boolean).join(' ');

      return `
        <button type="button" class="${cls}" data-date="${day.date}" ${day.isFull ? 'disabled' : ''}>
          <span class="room-cal-weekday">${day.weekday}</span>
          <span class="room-cal-date">${day.displayDay}</span>
          <span class="room-cal-month">${day.displayMonth}月</span>
          <div class="room-cal-mini">${mini}</div>
          <span class="room-cal-avail">${day.isFull ? '已满' : `余 ${day.freeSlots} 段`}</span>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.room-cal-day:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => selectCalendarDay(btn.dataset.date));
    });
  }

  function selectCalendarDay(date) {
    selectedDate = date;
    selectedSlot = null;
    renderCalendarGrid();
    renderCalendarDetail();
    document.getElementById('roomCalendarProceed').disabled = true;
  }

  function renderCalendarDetail() {
    const detail = document.getElementById('roomCalendarDetail');
    const day = calendarData.days.find(d => d.date === selectedDate);
    if (!day) {
      hideCalendarDetail();
      return;
    }

    detail.classList.remove('hidden');
    document.getElementById('roomCalendarDetailTitle').textContent =
      `${day.displayMonth}月${day.displayDay}日 ${day.weekday} · 选择空闲时段`;

    const slotGrid = document.getElementById('roomCalendarSlotGrid');
    slotGrid.innerHTML = day.slots.map(s => {
      const label = s.status === 'booked' ? '已约' : s.status === 'past' ? '已过' : s.time;
      const cls = ['room-cal-slot', s.status, selectedSlot === s.time ? 'selected' : ''].filter(Boolean).join(' ');
      const disabled = s.status !== 'free';
      return `<button type="button" class="${cls}" data-slot="${s.time}" ${disabled ? 'disabled' : ''}>${label}</button>`;
    }).join('');

    slotGrid.querySelectorAll('.room-cal-slot:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedSlot = btn.dataset.slot;
        renderCalendarDetail();
        document.getElementById('roomCalendarProceed').disabled = false;
      });
    });
  }

  function hideCalendarDetail() {
    document.getElementById('roomCalendarDetail')?.classList.add('hidden');
  }

  window.initRoomCalendar = initRoomCalendar;
  window.openRoomCalendar = openRoomCalendar;
})();
