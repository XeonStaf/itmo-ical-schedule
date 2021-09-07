const fetch = require('node-fetch').default;
const addMonths = require('date-fns/addMonths');
const subMonths = require('date-fns/subMonths');
const format = require('date-fns/format');
const ics = require('ics');


const username = process.env.USERNAME;
const password = process.env.password;

//const OPENID_CONFIG_ENDPOINT = 'https://login.itmo.ru/auth/realms/itmo/.well-known/openid-configuration';
const TOKEN_ENDPOINT = 'https://login.itmo.ru/auth/realms/itmo/protocol/openid-connect/token';
const SCHEDULE_ENDPOINT = 'https://my.itmo.ru/api/schedule/schedule/personal';

const DATE_FORMAT_YMD = 'yyyy-MM-dd';

const pairTypes = {
  'Лекции': 'Лк',
  'Практические занятия': 'Пр',
  'Лабораторные занятия': 'Лаб'
};

const generateSchedule = (events) => {
  return new Promise((resolve, reject) => {

    ics.createEvents(events, (error, value) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    });
  });
}


exports.handler = async (event, context) => {
  try {
    const tokenReq = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      body: new URLSearchParams({
          'client_id': 'student-personal-cabinet',
          'grant_type': 'password',

          'username': username,
          'password': password
      })
    });
    const token = await tokenReq.json();

    const now = new Date();
    const fromDate = format(subMonths(now, 3), DATE_FORMAT_YMD);
    const toDate = format(addMonths(now, 3), DATE_FORMAT_YMD);

    const scheduleReq = await fetch(`${SCHEDULE_ENDPOINT}?date_start=${fromDate}&date_end=${toDate}`, {
      headers: {
        'Authorization': `Bearer ${token['access_token']}`
      }
    });
    const schedule = await scheduleReq.json();

    const events = [];

    for (let day in schedule.data) {
      if (!day.lessons) continue;

      for (let lesson in day.lessons) {
        const pairType = pairTypes[lesson.type] || lesson.type;

        let title = `[${pairType}] ${lesson.subject}`;

        if (lesson.zoom_url) {
          title = `🌎${title}`;
        }

        console.log([ ...(day.date.split('-').map(x => parseInt(x, 10))), ...(lesson.time_start.split(':').map(x => parseInt(x, 10))) ]);
        const event = {
          productId: 'maksimkurb-itmo-ics',
          uid: `pair-${lesson.pair_id}@itmo.cubly.ru`,
          start: [ ...(day.date.split('-').map(x => parseInt(x, 10))), ...(lesson.time_start.split(':').map(x => parseInt(x, 10))) ],
          end: [ ...(day.date.split('-').map(x => parseInt(x, 10))), ...(lesson.time_end.split(':').map(x => parseInt(x, 10))) ],
          title,
          description:
          `Преподаватель: ${lesson.teacher_name}
${lesson.note ? `Примечание: ${lesson.note}` : ''}
Формат: ${lesson.format}
${lesson.zoom_url ? `Zoom URL: ${lesson.zoom_url}` : ''}
${lesson.zoom_password ? `Zoom PWD: ${lesson.zoom_password}` : ''}
${lesson.zoom_info ? `Zoom Info: ${lesson.zoom_info}` : ''}`,
          location: `${lesson.building}, ауд. ${lesson.room}`,
          url: lesson.zoom_url,
          status: 'CONFIRMED',
          busyStatus: 'BUSY',
          organizer: { name: lesson.teacher_name, email: 'noreply@cubly.ru' },
          alarms: [
            {
              action: 'audio',
              description: 'Reminder',
              trigger: {hours:0,minutes:10,before:true},
              repeat: 1
            }
          ]
        };

        events.push(event);
      }
    }

    const ical = await generateSchedule(events);

    return { statusCode: 200, body: ical };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed fetching data' }),
    };
  }
};
