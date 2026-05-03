import api from './api';

// Admin: AI fusion service'inden incident listesini al.
// Backend bunu ai-fusion'a proxyliyor (bkz. backend/controllers/incidentController.js).
//
// statusFilter: 'open' | 'closed' | undefined
export const getIncidents = async (statusFilter) => {
  try {
    const params = statusFilter ? { status_filter: statusFilter } : {};
    const response = await api.get('/admin/incidents', { params });
    return response.data; // { incidents: [...], total: N }
  } catch (error) {
    throw error.response?.data || { message: 'Olaylar alınırken bir hata oluştu' };
  }
};

// Admin: bir olaya bağlı orijinal mesajları (Alert) getir.
// Backend Alert._id üzerinden ai-fusion'ın event_ids[]'ine join yapıyor.
export const getIncidentMessages = async (incidentId) => {
  try {
    const response = await api.get(`/admin/incidents/${incidentId}/messages`);
    return response.data; // { messages: [...] }
  } catch (error) {
    throw error.response?.data || { message: 'Mesajlar alınamadı' };
  }
};

// Admin: olayı kapat. falseAlarm=true → status FALSE_ALARM, aksi halde CLOSED.
export const closeIncident = async (incidentId, falseAlarm = false) => {
  try {
    const response = await api.post(
      `/admin/incidents/${incidentId}/close`,
      null,
      { params: { false_alarm: falseAlarm ? 'true' : 'false' } }
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { message: 'Olay kapatılamadı' };
  }
};
