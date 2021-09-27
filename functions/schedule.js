const fetch = require('node-fetch').default;

const addMonths = require('date-fns/addMonths');
const subMonths = require('date-fns/subMonths');
const format = require('date-fns/format');
const fromUnixTime = require('date-fns/fromUnixTime')
const isFuture = require('date-fns/isFuture');
const { zonedTimeToUtc } = require('date-fns-tz');

const ics = require('ics');
const buildDbClient = require('../src/dbClient');

if (!process.env.NETLIFY) {
  require('dotenv').config()
}

const username = process.env.LOGIN;
const password = process.env.PASSWORD;
const email = process.env.EMAIL;

if (!username || !password) {
  throw new Error('LOGIN and PASSWORD are required environment variables');
}

const dbClient = buildDbClient();

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

async function getAuthToken(forceNew) {
  let dbToken;
  try {
    dbToken = await dbClient.findAuthToken();
  } catch (e) {
    console.log(e);
  }

  const body = {
    'client_id': 'is-app',
    'client_secret': '1b55dc77-51aa-4572-a8cd-869f16d1f525'
  };
  if (!forceNew && dbToken) {
    const updatedAt = Math.round(dbToken.ts / 1000000)

    const accessTokenExpiresIn = fromUnixTime(updatedAt + dbToken.data.expires_in)
    if (isFuture(accessTokenExpiresIn)) {
      console.log("Reusing saved token...");
      return dbToken.data;
    }

    const refreshTokenExpiresIn = fromUnixTime(updatedAt + dbToken.data.refresh_expires_in)
    if (isFuture(refreshTokenExpiresIn)) {
      console.log("Refreshing saved token...");
      body.grant_type = 'refresh_token';
      body.refresh_token = dbToken.data.refresh_token;
    }
  }
  if (!body.grant_type) {
    console.log("Gathering new token by password...");
    body.grant_type = 'password';
    body.username = username;
    body.password = password;
  }

  const tokenReq = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    body: new URLSearchParams(body)
  });
  const token = await tokenReq.json();

  if (tokenReq.status != 200) {
    throw new Error('Failed to auth: ' + JSON.stringify(token));
  }

  await dbClient.saveAuthToken(token, !!dbToken);

  return token;
}

async function fetchSchedule(token, fromDate, toDate) {
  const scheduleReq = await fetch(`${SCHEDULE_ENDPOINT}?date_start=${fromDate}&date_end=${toDate}`, {
    headers: {
      'Authorization': `Bearer ${token['access_token']}`
    }
  });
  if (scheduleReq.status != 200) {
    throw new Error("Unexpected schedule response code: "+scheduleReq.status)
  }
  return await scheduleReq.json();
}

exports.handler = async (event, context) => {
  try {
    let token = await getAuthToken();

    const now = new Date();
    const fromDate = format(subMonths(now, 3), DATE_FORMAT_YMD);
    const toDate = format(addMonths(now, 3), DATE_FORMAT_YMD);

    let schedule;
    try {
      schedule = await fetchSchedule(token, fromDate, toDate);
    } catch (e) {
      console.error(e);
      console.log("Trying to force refresh token...");
      token = await getAuthToken(true);
      schedule = await fetchSchedule(token, fromDate, toDate);
    }

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

    return {
      statusCode: 200, body: ical, headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline'
      }
    };
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

    return {
      statusCode: 200, body: ical, headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline'
      }
    };
  }
};
