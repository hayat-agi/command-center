import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  LinearProgress,
  Alert as MuiAlert,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Avatar,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import GroupIcon from '@mui/icons-material/Group';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import ElderlyIcon from '@mui/icons-material/Elderly';
import PregnantWomanIcon from '@mui/icons-material/PregnantWoman';
import VerifiedIcon from '@mui/icons-material/Verified';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import ScienceIcon from '@mui/icons-material/Science';
import BoltIcon from '@mui/icons-material/Bolt';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import LocalPoliceIcon from '@mui/icons-material/LocalPolice';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import HomeIcon from '@mui/icons-material/Home';
import InventoryIcon from '@mui/icons-material/Inventory';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MapComponent from '../components/MapComponent';
import { getIncidents } from '../services/incidentService';
import { getGateways } from '../api/gatewayService';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/tr';

dayjs.extend(relativeTime);
dayjs.locale('tr');

// ---- Constants -------------------------------------------------------------

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

const URGENCY_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

const GATEWAY_STATUS_COLOR = {
  active: '#2e7d32',
  inactive: '#9e9e9e',
  low_battery: '#ef6c00',
};

// Mesh proximity for connection lines (km). Real BLE/LoRa range is much
// shorter; this is an operational-overview number that keeps the network
// visualization legible at country zoom.
const MESH_PROXIMITY_KM = 80;

// Haversine distance between two {lat, lng} points, in kilometers.
const haversineKm = (a, b) => {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
};

// Match an incident's gateway_id (string) to a Gateway document. The string
// could be a stringified Mongo ObjectId (real flow) or a device_id (demo
// flow), so try both.
const findGatewayForIncident = (incident, gateways) => {
  if (!incident || !gateways || gateways.length === 0) return null;
  const ids = incident.gateway_ids || [];
  if (ids.length === 0) return null;
  for (const id of ids) {
    const match = gateways.find(
      (g) => g._id === id || g.serialNumber === id || g.device_id === id
    );
    if (match) return match;
  }
  return null;
};

// Build mesh-proximity lines: each gateway -> its 2 nearest neighbors (de-duped).
const computeMeshLines = (gateways) => {
  const valid = gateways.filter((g) => g.location?.lat != null && g.location?.lng != null);
  const seen = new Set();
  const lines = [];
  for (const g of valid) {
    const neighbors = valid
      .filter((o) => o._id !== g._id)
      .map((o) => ({ o, d: haversineKm(g.location, o.location) }))
      .filter((x) => x.d <= MESH_PROXIMITY_KM)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { o } of neighbors) {
      const key = [g._id, o._id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({
        from: [g.location.lat, g.location.lng],
        to: [o.location.lat, o.location.lng],
        color: '#78909c',
        weight: 1.2,
        opacity: 0.45,
        dashArray: '4 6',
      });
    }
  }
  return lines;
};

const CATEGORY_LABELS = {
  MEDICAL_RESCUE: 'Tıbbi Kurtarma',
  FIRE: 'Yangın',
  HAZMAT: 'Tehlikeli Madde',
  ELECTRICAL: 'Elektrik Arızası',
  WATER: 'Su Arızası',
  SECURITY: 'Güvenlik',
  MISSING_PERSON: 'Kayıp Kişi',
  CHILD_UNACCOMPANIED: 'Yalnız Çocuk',
  RESOURCE_REQUEST: 'Yardım Talebi',
  SHELTER: 'Barınma',
  GENERAL: 'Genel',
};

const CATEGORY_ICONS = {
  MEDICAL_RESCUE: LocalHospitalIcon,
  FIRE: LocalFireDepartmentIcon,
  HAZMAT: ScienceIcon,
  ELECTRICAL: BoltIcon,
  WATER: WaterDropIcon,
  SECURITY: LocalPoliceIcon,
  MISSING_PERSON: PersonSearchIcon,
  CHILD_UNACCOMPANIED: ChildCareIcon,
  RESOURCE_REQUEST: InventoryIcon,
  SHELTER: HomeIcon,
  GENERAL: InfoOutlinedIcon,
};

const CONFIRMATION = {
  CONFIRMED: { label: 'Onaylandı', color: 'success', icon: VerifiedIcon, hint: 'En az bir self-report ve bir witness-report eşleşti.' },
  LIKELY: { label: 'Olası', color: 'info', icon: HelpOutlineIcon, hint: 'Birden fazla witness-report var ama doğrudan etkilenen yok.' },
  UNCONFIRMED: { label: 'Onaylanmadı', color: 'warning', icon: HelpOutlineIcon, hint: 'Tek mesaj — kuvvetlenmesi bekleniyor.' },
  UNVERIFIED: { label: 'Doğrulanmadı', color: 'default', icon: HelpOutlineIcon, hint: 'Sadece bilgi mesajı; tehlike kanıtı yok.' },
};

// ---- Helpers ---------------------------------------------------------------

const incidentToGatewayShape = (incident) => ({
  _id: incident.id,
  name: incident.auto_summary || `Olay ${incident.id?.slice(0, 6) ?? ''}`,
  status: incident.status?.toLowerCase() === 'open' ? 'active' : 'inactive',
  battery: 100,
  location: incident.centroid,
  urgency: incident.max_urgency,
  __raw: incident,
});

const sortByScore = (a, b) => (b.score ?? 0) - (a.score ?? 0);
const sortByTime = (a, b) => new Date(b.last_event_at || b.created_at || 0) - new Date(a.last_event_at || a.created_at || 0);

const fromNowSafe = (ts) => (ts ? dayjs(ts).fromNow() : '—');

// ---- Subcomponents ---------------------------------------------------------

const StatsHeader = ({ incidents }) => {
  const counts = useMemo(() => {
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    incidents.forEach((i) => {
      if (i.max_urgency in c) c[i.max_urgency] += 1;
    });
    return c;
  }, [incidents]);

  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }}>
      {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((u) => (
        <Card
          key={u}
          variant="outlined"
          sx={{
            flex: '1 1 140px',
            borderTop: `3px solid ${URGENCY_COLORS[u]}`,
            transition: 'transform 0.15s',
            '&:hover': { transform: 'translateY(-2px)' },
          }}
        >
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" alignItems="baseline" spacing={1}>
              <Typography variant="h4" fontWeight={800} sx={{ color: URGENCY_COLORS[u] }}>
                {counts[u]}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {URGENCY_LABELS[u]}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
};

const VulnerableSignals = ({ incident, size = 'small' }) => {
  const items = [];
  if (incident.has_child_signal) items.push({ icon: ChildCareIcon, label: 'Çocuk', color: '#e91e63' });
  if (incident.has_elderly_signal) items.push({ icon: ElderlyIcon, label: 'Yaşlı', color: '#7b1fa2' });
  if (incident.has_pregnant_signal) items.push({ icon: PregnantWomanIcon, label: 'Hamile', color: '#c2185b' });
  if (items.length === 0) return null;
  return (
    <Stack direction="row" spacing={0.5}>
      {items.map(({ icon: Icon, label, color }) => (
        <Tooltip key={label} title={label}>
          <Avatar sx={{ width: size === 'small' ? 22 : 32, height: size === 'small' ? 22 : 32, bgcolor: alpha(color, 0.15), color }}>
            <Icon sx={{ fontSize: size === 'small' ? 14 : 18 }} />
          </Avatar>
        </Tooltip>
      ))}
    </Stack>
  );
};

const CategoryChip = ({ code, size = 'small' }) => {
  const Icon = CATEGORY_ICONS[code] || InfoOutlinedIcon;
  return (
    <Chip
      icon={<Icon sx={{ fontSize: 14 }} />}
      label={CATEGORY_LABELS[code] || code}
      size={size}
      variant="outlined"
      sx={{ height: size === 'small' ? 22 : 28 }}
    />
  );
};

const IncidentCard = ({ incident, isSelected, onClick }) => {
  const color = URGENCY_COLORS[incident.max_urgency] || '#9e9e9e';
  const conf = CONFIRMATION[incident.confirmation] || CONFIRMATION.UNCONFIRMED;
  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        borderLeft: `4px solid ${color}`,
        boxShadow: isSelected ? `0 0 0 2px ${color}` : undefined,
        transition: 'box-shadow 0.15s',
        '&:hover': { boxShadow: `0 0 0 2px ${alpha(color, 0.5)}` },
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
          <Chip
            label={URGENCY_LABELS[incident.max_urgency] || incident.max_urgency}
            size="small"
            sx={{ bgcolor: color, color: 'white', fontWeight: 700, height: 22 }}
          />
          <Chip label={conf.label} size="small" color={conf.color} variant="outlined" sx={{ height: 22 }} />
          <VulnerableSignals incident={incident} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {fromNowSafe(incident.last_event_at || incident.created_at)}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ mb: 0.75, fontWeight: 500 }}>
          {incident.auto_summary || `Olay ${incident.id?.slice(0, 8)}`}
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 0.75 }}>
          {(incident.categories || []).slice(0, 3).map((c) => (
            <CategoryChip key={c} code={c} />
          ))}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <GroupIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">
              {incident.n_messages ?? 0}
            </Typography>
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ fontWeight: 700 }} color={color}>
            {incident.score?.toFixed(2) ?? '—'}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

const ScoreBreakdown = ({ breakdown }) => {
  if (!breakdown) return null;
  const rows = [
    { key: 'base', label: 'Aciliyet × Onay' },
    { key: 'message_count_bonus', label: 'Mesaj sayısı bonusu' },
    { key: 'vulnerable_group_bonus', label: 'Risk grubu bonusu' },
    { key: 'hazard_bonus', label: 'Tehlike bonusu' },
  ];
  const max = Math.max(...rows.map((r) => breakdown[r.key] || 0), 1);
  return (
    <Stack spacing={0.75}>
      {rows.map((r) => {
        const val = breakdown[r.key] || 0;
        return (
          <Box key={r.key}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
              <Typography variant="caption" color="text.secondary">
                {r.label}
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {val.toFixed(2)}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={(val / max) * 100}
              sx={{ height: 4, borderRadius: 2, opacity: val > 0 ? 1 : 0.3 }}
            />
          </Box>
        );
      })}
    </Stack>
  );
};

const IncidentDetail = ({ incident, onBack, sourceGateway }) => {
  const color = URGENCY_COLORS[incident.max_urgency] || '#9e9e9e';
  const conf = CONFIRMATION[incident.confirmation] || CONFIRMATION.UNCONFIRMED;
  const ConfIcon = conf.icon;

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <Box sx={{ bgcolor: color, color: 'white', px: 2, py: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton size="small" onClick={onBack} sx={{ color: 'white' }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="overline" sx={{ letterSpacing: 1, fontWeight: 700 }}>
            {URGENCY_LABELS[incident.max_urgency]}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography variant="h5" fontWeight={800}>
            {incident.score?.toFixed(2) ?? '—'}
          </Typography>
        </Stack>
      </Box>
      <CardContent sx={{ flex: 1 }}>
        <Typography variant="body1" fontWeight={500} sx={{ mb: 2 }}>
          {incident.auto_summary || `Olay ${incident.id?.slice(0, 8)}`}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <Chip
            icon={<ConfIcon sx={{ fontSize: 14 }} />}
            label={conf.label}
            color={conf.color}
            size="small"
          />
          <Tooltip title={conf.hint}>
            <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <VulnerableSignals incident={incident} size="medium" />
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          KATEGORİLER
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mb: 2 }}>
          {(incident.categories || []).map((c) => (
            <CategoryChip key={c} code={c} size="medium" />
          ))}
          {(incident.categories || []).length === 0 && (
            <Typography variant="caption" color="text.secondary">Kategori atanmadı</Typography>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          MESAJ DAĞILIMI ({incident.n_messages} toplam)
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Chip label={`${incident.n_self_reports} self`} size="small" variant="outlined" />
          <Chip label={`${incident.n_witness_reports} tanık`} size="small" variant="outlined" />
          <Chip label={`${incident.n_info} bilgi`} size="small" variant="outlined" />
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          SKOR DETAYI
        </Typography>
        <Box sx={{ mb: 2 }}>
          <ScoreBreakdown breakdown={incident.score_breakdown} />
        </Box>

        {incident.dispatched_teams && incident.dispatched_teams.length > 0 && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              SEVK EDİLEN EKİPLER
            </Typography>
            <Stack spacing={0.75} sx={{ mb: 2 }}>
              {incident.dispatched_teams.map((t, idx) => (
                <Stack key={`${t.team_code}-${idx}`} direction="row" alignItems="center" spacing={1}>
                  <Chip label={`P${t.priority ?? idx + 1}`} size="small" color="primary" sx={{ minWidth: 36, height: 22 }} />
                  <Typography variant="body2" fontWeight={500}>{t.team_code}</Typography>
                  {t.reason && (
                    <Typography variant="caption" color="text.secondary">— {t.reason}</Typography>
                  )}
                </Stack>
              ))}
            </Stack>
          </>
        )}

        <Divider sx={{ mb: 2 }} />

        {sourceGateway && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              KAYNAK GATEWAY
            </Typography>
            <Card variant="outlined" sx={{ mb: 2, bgcolor: alpha(color, 0.06), borderColor: alpha(color, 0.4) }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Box
                    sx={{
                      width: 10, height: 10, borderRadius: '50%',
                      bgcolor: GATEWAY_STATUS_COLOR[sourceGateway.status] || '#9e9e9e',
                    }}
                  />
                  <Typography variant="body2" fontWeight={600}>
                    {sourceGateway.name || sourceGateway.serialNumber}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">
                    Durum: <strong>{sourceGateway.status}</strong>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Pil: <strong>%{sourceGateway.battery ?? '?'}</strong>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Sinyal: <strong>{sourceGateway.signal_quality || '?'}</strong>
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </>
        )}

        <Stack spacing={0.5}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">Oluşturulma</Typography>
            <Typography variant="caption">{fromNowSafe(incident.created_at)}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">Son mesaj</Typography>
            <Typography variant="caption">{fromNowSafe(incident.last_event_at)}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">Gateway ID</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              {(incident.gateway_ids || []).join(', ') || '—'}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">Konum</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              {incident.centroid?.lat?.toFixed(4) ?? '—'}, {incident.centroid?.lng?.toFixed(4) ?? '—'}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">Olay ID</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{incident.id}</Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

// ---- Page ------------------------------------------------------------------

const Incidents = () => {
  const [incidents, setIncidents] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');
  const [sortBy, setSortBy] = useState('score');

  const loadIncidents = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      else setIsRefreshing(true);
      setError(null);
      const filter = statusFilter === 'all' ? undefined : statusFilter;
      const [incidentsData, gatewaysData] = await Promise.all([
        getIncidents(filter),
        getGateways().catch(() => []), // gateways are best-effort; don't block on them
      ]);
      setIncidents(incidentsData.incidents || []);
      setGateways(gatewaysData || []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Olaylar yüklenirken hata:', err);
      setError(err?.message || 'Olaylar yüklenemedi.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadIncidents(true); }, [loadIncidents]);
  useEffect(() => {
    const interval = setInterval(() => loadIncidents(false), 5000);
    return () => clearInterval(interval);
  }, [loadIncidents]);

  const sortedIncidents = useMemo(() => {
    const sorted = [...incidents];
    sorted.sort(sortBy === 'score' ? sortByScore : sortByTime);
    return sorted;
  }, [incidents, sortBy]);

  const selectedIncident = selectedId ? incidents.find((i) => i.id === selectedId) : null;
  const sourceGateway = useMemo(
    () => findGatewayForIncident(selectedIncident, gateways),
    [selectedIncident, gateways]
  );

  const mapItems = sortedIncidents
    .filter((i) => i.centroid?.lat != null && i.centroid?.lng != null)
    .map(incidentToGatewayShape);

  const colorResolver = (item) => URGENCY_COLORS[item.urgency] || '#9e9e9e';

  // Background gateway markers + mesh proximity lines
  const extraMarkers = useMemo(
    () =>
      gateways
        .filter((g) => g.location?.lat != null && g.location?.lng != null)
        .map((g) => ({
          id: g._id,
          lat: g.location.lat,
          lng: g.location.lng,
          color: GATEWAY_STATUS_COLOR[g.status] || GATEWAY_STATUS_COLOR.inactive,
          radius: 5,
          opacity: 0.9,
          fillOpacity: 0.45,
          label: g.name || g.serialNumber || 'Gateway',
          subtitle: `Durum: ${g.status} · Pil: %${g.battery ?? '?'}`,
          highlighted: sourceGateway && sourceGateway._id === g._id,
        })),
    [gateways, sourceGateway]
  );

  const meshLines = useMemo(() => computeMeshLines(gateways), [gateways]);

  // Source-link: line from incident's source gateway to the incident centroid
  const sourceLink = useMemo(() => {
    if (!sourceGateway || !selectedIncident?.centroid) return null;
    return {
      from: [sourceGateway.location.lat, sourceGateway.location.lng],
      to: [selectedIncident.centroid.lat, selectedIncident.centroid.lng],
      color: URGENCY_COLORS[selectedIncident.max_urgency] || '#1976d2',
      weight: 3,
      opacity: 0.85,
    };
  }, [sourceGateway, selectedIncident]);

  const allLines = useMemo(
    () => (sourceLink ? [...meshLines, sourceLink] : meshLines),
    [meshLines, sourceLink]
  );

  return (
    <Box sx={{ p: 3, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <ReportProblemIcon color="error" />
          <Typography variant="h5" fontWeight={700}>Olaylar</Typography>
          <Chip label={`${incidents.length}`} size="small" color="error" />
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>Durum</InputLabel>
            <Select value={statusFilter} label="Durum" onChange={(e) => setStatusFilter(e.target.value)}>
              <MenuItem value="open">Açık</MenuItem>
              <MenuItem value="closed">Kapalı</MenuItem>
              <MenuItem value="all">Hepsi</MenuItem>
            </Select>
          </FormControl>
          <ToggleButtonGroup size="small" exclusive value={sortBy} onChange={(_, v) => v && setSortBy(v)}>
            <ToggleButton value="score">Skor</ToggleButton>
            <ToggleButton value="time">Zaman</ToggleButton>
          </ToggleButtonGroup>
          {lastUpdate && (
            <Tooltip title={`Son güncelleme: ${dayjs(lastUpdate).format('HH:mm:ss')}`}>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <AccessTimeIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  {fromNowSafe(lastUpdate)}
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

      <StatsHeader incidents={incidents} />

      {error && <MuiAlert severity="error" sx={{ mb: 2 }}>{error}</MuiAlert>}

      <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Grid item xs={12} md={8} sx={{ minHeight: 500 }}>
          <Paper sx={{ height: '100%', minHeight: 500, position: 'relative', overflow: 'hidden' }}>
            <MapComponent
              gateways={mapItems}
              selectedGateway={selectedIncident ? incidentToGatewayShape(selectedIncident) : null}
              onMarkerClick={(item) => setSelectedId(item._id)}
              loading={loading}
              error={null}
              isRefreshing={isRefreshing}
              colorResolver={colorResolver}
              extraMarkers={extraMarkers}
              lines={allLines}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} md={4} sx={{ minHeight: 500, height: '100%', overflow: 'hidden' }}>
          {selectedIncident ? (
            <Box sx={{ height: '100%', overflow: 'auto' }}>
              <IncidentDetail
                incident={selectedIncident}
                onBack={() => setSelectedId(null)}
                sourceGateway={sourceGateway}
              />
            </Box>
          ) : (
            <Stack spacing={1.5} sx={{ height: '100%', overflowY: 'auto', pr: 1 }}>
              {loading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress />
                </Box>
              )}
              {!loading && sortedIncidents.length === 0 && (
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="body2" color="text.secondary" align="center">
                      Bu filtre için olay yok.
                    </Typography>
                  </CardContent>
                </Card>
              )}
              {sortedIncidents.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  isSelected={selectedId === incident.id}
                  onClick={() => setSelectedId(incident.id)}
                />
              ))}
            </Stack>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default Incidents;
