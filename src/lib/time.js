const MEXICO_CITY_TZ = 'America/Mexico_City';

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatLocalDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function getServerTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'server-local';
}

export function getServerDatetime() {
    return formatLocalDate(new Date());
}

export function getMexicoCityDatetime() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: MEXICO_CITY_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(new Date());
    const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${valueByType.year}-${valueByType.month}-${valueByType.day} ${valueByType.hour}:${valueByType.minute}:${valueByType.second}`;
}

export function getRankingTimeContext() {
    return {
        mexicoNow: getMexicoCityDatetime(),
        serverNow: getServerDatetime(),
        serverTimeZone: getServerTimeZone(),
        rankingTimeZone: MEXICO_CITY_TZ,
    };
}

