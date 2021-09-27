const fetch = require('node-fetch').default;
const addMonths = require('date-fns/addMonths');
const subMonths = require('date-fns/subMonths');
const format = require('date-fns/format');
const parse = require('date-fns/parse');
const { zonedTimeToUtc } = require('date-fns-tz')
const ics = require('ics');


const username = process.env.USERNAME;
const password = process.env.PASSWORD;
const email = process.env.EMAIL;

//const OPENID_CONFIG_ENDPOINT = 'https://login.itmo.ru/auth/realms/itmo/.well-known/openid-configuration';
const TOKEN_ENDPOINT = 'https://login.itmo.ru/auth/realms/itmo/protocol/openid-connect/token';
const SCHEDULE_ENDPOINT = 'https://my.itmo.ru/api/schedule/schedule/personal';

const DATE_FORMAT_YMD = 'yyyy-MM-dd';
const DATE_REGEX_UTC = /(\d+)-(\d+)-(\d+)T(\d+):(\d+)/;

const pairTypes = {
  'Экзамен': 'ЭКЗ',
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

function convertDate(date) {
  const groups = date.toISOString().match(DATE_REGEX_UTC);

  return [groups[1], groups[2], groups[3], groups[4], groups[5]].map(x => parseInt(x, 10));
}

exports.handler = async (event, context) => {
  try {
    const tokenReq = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      body: new URLSearchParams({
          'client_id': 'is-app',
          'client_secret': '1b55dc77-51aa-4572-a8cd-869f16d1f525',
          'grant_type': 'password',

          'username': username,
          'password': password
      })
    });
    const token = await tokenReq.json();

    if (tokenReq.status != 200) {
      throw new Error('Failed to auth: '+JSON.stringify(token));
    }

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

    if (schedule.code !== 0) {
      throw new Error(JSON.stringify(schedule.message));
    }

    for (let day of schedule.data) {
      if (!day.lessons.length) continue;

      for (let lesson of day.lessons) {
        const pairType = pairTypes[lesson.type] || lesson.type;

        let title = `[${pairType}] ${lesson.subject}`;

        if (lesson.zoom_url) {
          title = `🌎${title}`;
        }

        const startDateString = `${day.date} ${lesson.time_start}:00.000`;
        const startDate = zonedTimeToUtc(startDateString, 'Europe/Moscow');
        const endDateString = `${day.date} ${lesson.time_end}:00.000`;
        const endDate = zonedTimeToUtc(endDateString, 'Europe/Moscow');

        const event = {
          productId: 'maksimkurb-itmo-ics',
          uid: `pair-${lesson.pair_id}@itmo.cubly.ru`,
          start: convertDate(startDate),
          startInputType: 'utc',
          end: convertDate(endDate),
          endInputType: 'utc',
          title,
          description:
          `Преподаватель: ${lesson.teacher_name || '[пусто]'}
${lesson.note ? `Примечание: ${lesson.note}` : ''}
Формат: ${lesson.format}
${lesson.zoom_url ? `Zoom URL: ${lesson.zoom_url}` : ''}
${lesson.zoom_password ? `Zoom PWD: ${lesson.zoom_password || '[пусто]'}` : ''}
${lesson.zoom_info ? `Zoom Info: ${lesson.zoom_info || '[пусто]'}` : ''}`,
          location: (lesson.building || lesson.room) ? `${lesson.building || '[адрес не указан]'}, ауд. ${lesson.room || '[не указана]'}` : 'Аудитория не указана',
          url: lesson.zoom_url,
          status: 'CONFIRMED',
          busyStatus: 'BUSY',
          organizer: { name: lesson.teacher_name || 'Преподаватель не указан', email: 'noreply@cubly.ru' }
        };

        if (email != null && email != '') {
          event.attendees = [
            { name: 'Student', email: email, rsvp: false, partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' }
          ];
        }

        events.push(event);
      }
    }

    const ical = await generateSchedule(events);

    return { statusCode: 200, body: ical, headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline'
    } };
  } catch (error) {
    const event = {
      productId: 'maksimkurb-itmo-ics',
      uid: `failure@itmo.cubly.ru`,
      start: [2021, 09, 01],
      startInputType: 'utc',
      end: [3021, 09, 01],
      endInputType: 'utc',
      title: 'ITMO SCHED BROKEN (see description)',
      description:
      `Failed to fetch your schedule: ${error.message}`,
      status: 'CONFIRMED',
      busyStatus: 'BUSY'
    };

    const ical = await generateSchedule([event]);

    return { statusCode: 200, body: ical, headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline'
    } };
  }
};
