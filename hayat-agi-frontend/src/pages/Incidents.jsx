import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Card,
  CardContent,
  Chip,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Divider,
  alpha,
  CircularProgress,
  Alert as MuiAlert,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import GroupIcon from '@mui/icons-material/Group';
import MapComponent from '../components/MapComponent';
import { getIncidents } from '../services/incidentService';
import dayjs from 'dayjs';

const URGENCY_COLORS = {
  CRITICAL: '#d32f2f',
  HIGH: '#f57c00',
  MEDIUM: '#fbc02d',
  LOW: '#1976d2',
};

const URGENCY_LABELS = {
  CRITICAL: 'Kritik',
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
};

// AI fusion service'in Incident şemasını MapComponent'in beklediği gateway-benzeri
// objeye çeviriyoruz. Marker rengi colorResolver üzerinden urgency'ye göre belirlenir.
const incidentToGatewayShape = (incident) => ({
  _id: incident.id,
  name: incident.auto_summary || `Olay ${incident.id?.slice(0, 6) ?? ''}`,
  status: incident.status?.toLowerCase() === 'open' ? 'active' : 'inactive',
  battery: 100, // unused — colorResolver overrides
  location: incident.centroid,
  urgency: incident.max_urgency,
  __raw: incident,
});

const Incidents = () => {
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');

  const loadIncidents = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      else setIsRefreshing(true);
      setError(null);

      const filter = statusFilter === 'all' ? undefined : statusFilter;
      const data = await getIncidents(filter);
      setIncidents(data.incidents || []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Olaylar yüklenirken hata:', err);
      setError(err?.message || 'Olaylar yüklenemedi.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadIncidents(true);
  }, [loadIncidents]);

  useEffect(() => {
    const interval = setInterval(() => loadIncidents(false), 5000);
    return () => clearInterval(interval);
  }, [loadIncidents]);

  const mapItems = incidents
    .filter((i) => i.centroid?.lat != null && i.centroid?.lng != null)
    .map(incidentToGatewayShape);

  const colorResolver = (item) => URGENCY_COLORS[item.urgency] || '#9e9e9e';

  const handleSelect = (item) => {
    const raw = incidents.find((i) => i.id === item._id);
    setSelectedIncident(raw || null);
  };

  return (
    <Box sx={{ p: 3, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <ReportProblemIcon color="error" />
          <Typography variant="h5" fontWeight={700}>
            Olaylar
          </Typography>
          <Chip label={`${incidents.length} aktif`} color="error" size="small" />
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Durum</InputLabel>
            <Select
              value={statusFilter}
              label="Durum"
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="open">Açık</MenuItem>
              <MenuItem value="closed">Kapalı</MenuItem>
              <MenuItem value="all">Hepsi</MenuItem>
            </Select>
          </FormControl>
          {lastUpdate && (
            <Tooltip title={`Son güncelleme: ${dayjs(lastUpdate).format('HH:mm:ss')}`}>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <AccessTimeIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  {dayjs(lastUpdate).format('HH:mm:ss')}
                </Typography>
              </Stack>
            </Tooltip>
          )}
          <Tooltip title="Yenile">
            <IconButton onClick={() => loadIncidents(false)} disabled={isRefreshing}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          {error}
        </MuiAlert>
      )}

      <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Grid item xs={12} md={8} sx={{ minHeight: 500 }}>
          <Paper sx={{ height: '100%', minHeight: 500, position: 'relative', overflow: 'hidden' }}>
            <MapComponent
              gateways={mapItems}
              selectedGateway={selectedIncident ? incidentToGatewayShape(selectedIncident) : null}
              onMarkerClick={handleSelect}
              loading={loading}
              error={null}
              isRefreshing={isRefreshing}
              colorResolver={colorResolver}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} md={4} sx={{ minHeight: 500, overflowY: 'auto' }}>
          <Stack spacing={1.5}>
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            )}
            {!loading && incidents.length === 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary" align="center">
                    Aktif olay yok.
                  </Typography>
                </CardContent>
              </Card>
            )}
            {incidents.map((incident) => {
              const isSel = selectedIncident?.id === incident.id;
              const color = URGENCY_COLORS[incident.max_urgency] || '#9e9e9e';
              return (
                <Card
                  key={incident.id}
                  onClick={() => setSelectedIncident(incident)}
                  sx={{
                    cursor: 'pointer',
                    border: `2px solid ${isSel ? color : 'transparent'}`,
                    transition: 'border-color 0.2s',
                    '&:hover': { borderColor: alpha(color, 0.5) },
                  }}
                >
                  <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Chip
                        label={URGENCY_LABELS[incident.max_urgency] || incident.max_urgency}
                        size="small"
                        sx={{ bgcolor: color, color: 'white', fontWeight: 700 }}
                      />
                      <Chip
                        label={incident.confirmation || 'unconfirmed'}
                        size="small"
                        variant="outlined"
                      />
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        {dayjs(incident.last_event_at || incident.created_at).format('HH:mm')}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {incident.auto_summary || `Olay ${incident.id?.slice(0, 8)}`}
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 1 }}>
                      {(incident.categories || []).map((cat) => (
                        <Chip key={cat} label={cat} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                      ))}
                    </Stack>
                    <Divider sx={{ my: 1 }} />
                    <Stack direction="row" spacing={2}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <GroupIcon fontSize="small" color="action" />
                        <Typography variant="caption" color="text.secondary">
                          {incident.n_messages ?? 0} mesaj
                        </Typography>
                      </Stack>
                      {incident.centroid && (
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <LocationOnIcon fontSize="small" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {incident.centroid.lat?.toFixed(3)}, {incident.centroid.lng?.toFixed(3)}
                          </Typography>
                        </Stack>
                      )}
                      {incident.score != null && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                          Skor: <strong>{incident.score.toFixed(2)}</strong>
                        </Typography>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Incidents;
