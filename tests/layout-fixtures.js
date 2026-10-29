// Synthetic data only: never uses library.db or real personal records.
const book={id:'b1',title:'活着',author:'余华',category:'文学',isbn:'9787506349106',copies:3,available:2};
const longBook={...book,id:'b-long',title:'DesigningDataIntensiveApplications2026SpecialEdition',author:'长名字作者与社区读书小组联合推荐',isbn:'978123456789012345678901234567890'};
const room={id:'demo',purpose:'邻里读书分享会',date:'2026-11-01',weekday:'周日',displayMonth:11,displayDay:1,freeSlots:7,attendees:20,timeSlot:'10:00',duration:2,code:'HD1ABCDEFG',slots:Array.from({length:12},(_,i)=>({time:String(i+8).padStart(2,'0')+':00',status:i<3?'past':i===5?'booked':'free',label:i<3?'已结束':i===5?'已预约':'可预约'}))};
const review={id:'r1',bookId:'b1',bookTitle:'活着',name:'测试读者',phone:'13800000000',rating:5,status:'pending',statusLabel:'待审核',content:'在阅读中发现生活的力量。与邻里分享好书，也一起照料社区花园。',createdAt:'2026-10-30T10:00:00',updatedAt:'2026-10-30T10:00:00'};
const garden=require('../miniprogram/data/garden');
const me={username:'admin',displayName:'社区管理员'};
const stats=[{key:'total',label:'馆藏种类',value:16},{key:'borrow',label:'正在借阅',value:8},{key:'return',label:'累计归还',value:32},{key:'pending',label:'待审核书评',value:3,attention:true}];
const days=Array.from({length:15},(_,i)=>({...room,date:'2026-11-'+String(i+1).padStart(2,'0'),displayDay:i+1,openCount:8}));
module.exports={
 garden:{page:'garden',data:{sections:garden.map(s=>({...s,photos:s.photos.map(p=>({...p,url:p.path}))})),map:'/static/images/garden/garden-plan.jpg',hero:'/static/images/garden/build/figure20.jpg'}},
 books:{page:'books',data:{books:[book,{...book,id:'b2',title:'百年孤独',author:'加西亚·马尔克斯'},{...book,id:'b3',title:'三体',category:'科幻',author:'刘慈欣'},{...book,id:'b4',title:'人类简史',author:'尤瓦尔·赫拉利'},{...book,id:'b5',title:'小王子',author:'圣·埃克苏佩里'},longBook]}},
 'books-empty':{page:'books',data:{books:[],search:'未收录的书'}},
 'books-error':{page:'books',data:{error:'无法连接服务，请检查网络后重试'}},
 book:{page:'book',data:{book,reviews:[review],reviewCount:1,avgRating:5}},
 'book-long':{page:'book',data:{book:longBook,reviews:[review],reviewCount:1,avgRating:5}},
 room:{page:'room',data:{days,slots:room.slots,date:room.date,weekday:room.weekday,timeSlot:'12:00',duration:1,endTime:'13:00'}},
 mine:{page:'mine',data:{queried:true,phone:'13800000000',queriedPhone:'13800000000',records:[{...book,bookId:'b1',bookTitle:'活着',code:'JY12345AB',status:'borrowed',statusLabel:'借阅中',borrowDate:'2026-10-30',dueDate:'2026-11-29'}]}},
 'mine-rooms':{page:'mine',data:{queried:true,kind:'rooms',records:[{...room,status:'upcoming',statusLabel:'待使用 / 待签退',canCheckout:true}]}},
 'mine-reviews':{page:'mine',data:{queried:true,kind:'reviews',records:[review]}},
 review:{page:'review',data:{book,form:{name:'测试读者',phone:'13800000000',content:'一本值得在社区读书分享会上推荐的书。',rating:5}}},
 checkout:{page:'checkout',data:{record:room}},
 privacy:{page:'privacy',data:{}},
 'admin-login':{page:'admin',data:{checking:false}},
 admin:{page:'admin',data:{checking:false,me,stats,popularBooks:[{title:'活着',author:'余华',count:8},{title:longBook.title,author:longBook.author,count:6}]}},
 'admin-books':{page:'admin',data:{checking:false,me,panel:'books',items:[book,longBook]}},
 'admin-borrows':{page:'admin',data:{checking:false,me,panel:'borrows',items:[{...review,code:'JYABCDEFG',status:'borrowed',borrowDate:'2026-10-30',dueDate:'2026-11-29'}]}},
 'admin-reviews':{page:'admin',data:{checking:false,me,panel:'reviews',items:[review],rejectId:'r1'}},
 'admin-rooms':{page:'admin',data:{checking:false,me,panel:'rooms',items:[{...room,status:'upcoming',statusLabel:'待使用 / 待签退',name:'测试居民',phone:'13800000000'}]}},
 'admin-slots':{page:'admin',data:{checking:false,me,panel:'slots',selectedDate:room.date,startDate:room.date,endDate:'2026-11-15',slotDays:days,slotOptions:room.slots.map(s=>({time:s.time,checked:true})),daySlots:room.slots,dayBookings:[{...room,name:'测试居民',phone:'13800000000'}]}},
 'admin-material':{page:'admin',data:{checking:false,me,stats,material:{name:'测试居民',date:room.date,code:room.code,volunteerNote:'今天在社区花园完成浇水、除草与花池清理，服务约半小时。'.repeat(15),imageUrl:'/static/images/garden/build/figure20.jpg'}}},
 'admin-book':{page:'admin-book',data:{loading:false,authenticated:true}}
};
