export function formatActivityDate(dateString: string | undefined | null): string {
    if (!dateString) return 'Fecha desconocida';
    
    // Asumimos que la fecha de la base de datos MySQL (UTC) viene como "YYYY-MM-DD HH:mm:ss"
    // o un string ISO "YYYY-MM-DDTHH:mm:ss.sssZ"
    let dateObj: Date;

    if (dateString.includes('T')) {
        dateObj = new Date(dateString);
    } else {
        // Transformar "2024-03-14 10:15:00" a ISO para forzar que JS lo entienda como UTC
        const isoString = dateString.trim().replace(' ', 'T') + 'Z';
        dateObj = new Date(isoString);
    }

    if (isNaN(dateObj.getTime())) {
        return 'Fecha inválida';
    }

    // Retorna la fecha usando la configuración local del usuario
    return dateObj.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

export function getTimeAgoLocal(dateString: string | undefined | null): string {
    if (!dateString) return 'Hace un momento';

    let dateObj: Date;
    if (dateString.includes('T')) {
        dateObj = new Date(dateString);
    } else {
        const isoString = dateString.trim().replace(' ', 'T') + 'Z';
        dateObj = new Date(isoString);
    }

    if (isNaN(dateObj.getTime())) {
        return '';
    }

    const now = new Date();
    // La resta siempre da milisegundos netos sin importar husos horarios
    const diffInHours = Math.floor((now.getTime() - dateObj.getTime()) / (1000 * 60 * 60));
    const diffInMinutes = Math.floor((now.getTime() - dateObj.getTime()) / (1000 * 60));

    if (diffInMinutes < 60) {
        if (diffInMinutes <= 0) return 'Hace un instante';
        return `Hace ${diffInMinutes} min`;
    }
    if (diffInHours < 24) return `Hace ${diffInHours}h`;
    return `Hace ${Math.floor(diffInHours / 24)}d`;
}
