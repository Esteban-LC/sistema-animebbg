import { EventEmitter } from 'events';

const globalForRealtime = globalThis;

if (!globalForRealtime.__animebbgRealtimeEmitter) {
    globalForRealtime.__animebbgRealtimeEmitter = new EventEmitter();
    globalForRealtime.__animebbgRealtimeEmitter.setMaxListeners(200);
}

const emitter = globalForRealtime.__animebbgRealtimeEmitter;

export function publishNotificationEvent(payload) {
    emitter.emit('notification', payload);
}

export function subscribeNotificationEvent(handler) {
    emitter.on('notification', handler);
    return () => {
        emitter.off('notification', handler);
    };
}

export function publishProjectEvent(payload) {
    emitter.emit('project', payload);
}

export function subscribeProjectEvent(handler) {
    emitter.on('project', handler);
    return () => {
        emitter.off('project', handler);
    };
}

export function publishAssignmentEvent(payload) {
    emitter.emit('assignment', payload);
}

export function subscribeAssignmentEvent(handler) {
    emitter.on('assignment', handler);
    return () => {
        emitter.off('assignment', handler);
    };
}

export function publishRankingEvent(payload) {
    emitter.emit('ranking', payload);
}

export function subscribeRankingEvent(handler) {
    emitter.on('ranking', handler);
    return () => {
        emitter.off('ranking', handler);
    };
}
