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
  Divider,
  alpha,
  CircularProgress,
  Alert as MuiAlert,
  Button,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControlLabel,
  Checkbox,
  TextField,
  InputAdornment,
  Fab,
  Badge,
  Collapse,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GroupIcon from '@mui/icons-material/Group';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import ElderlyIcon from '@mui/icons-material/Elderly';
import PregnantWomanIcon from '@mui/icons-material/PregnantWoman';
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
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import RouterIcon from '@mui/icons-material/Router';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import MapComponent from '../components/MapComponent';
import SourceBadge from '../components/SourceBadge';
import { getIncidents, getIncidentMessages, closeIncident } from '../services/incidentService';
import { getGateways } from '../api/gatewayService';
import {
  DEFAULT_COVERAGE_M,
  computeClusters,
  computeMeshLines,
} from '../utils/meshTopology';
import { synthesizeHopPath } from '../utils/synthesizeHopPath';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/tr';

dayjs.extend(relativeTime);
dayjs.locale('tr');

// ---- Constants -------------------------------------------------------------

// Tuned for legibility on a neutral light tile (CartoDB Positron). Yellow
// at #fbc02d washed out against any tile background — bumped MEDIUM to a
// darker amber so the four tiers stay distinguishable AND each one passes
// a 3:1 contrast check against the map.
const URGENCY_COLORS = {
  CRITICAL: '#c62828',
  HIGH: '#e65100',
  MEDIUM: '#f57f17',
  LOW: '#1565c0',
};

const URGENCY_LABELS = {
  CRITICAL: 'Kritik',
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
};

const URGENCY_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

// Visual-only coverage radius used when drawing the on-map circles. The
// actual mesh-reach math (clusters, mesh lines) still uses DEFAULT_COVERAGE_M
// (the realistic 350m number) — this is purely so the painted circles don't
// dominate the map at campus zoom and the hop animation reads cleanly.
const COVERAGE_DISPLAY_M = 120;

const GATEWAY_INACTIVE_COLOR = '#9e9e9e';
const GATEWAY_ISOLATED_COLOR = '#ef6c00';

// Distinct cluster colors. First color is reserved for "connected".
const CLUSTER_PALETTE = ['#1976d2', '#388e3c', '#7b1fa2', '#0097a7', '#c2185b', '#5d4037', '#455a64', '#f9a825'];

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

// Color a gateway based on its cluster membership.
const colorForCluster = (clusterIdx, clusterSize) => {
  if (clusterSize <= 1) return GATEWAY_ISOLATED_COLOR; // singleton — needs a relay
  return CLUSTER_PALETTE[clusterIdx % CLUSTER_PALETTE.length];
};

// Decorate the shared computeMeshLines output with this page's cluster
// colors so each connected component gets its own line color.
const colorMeshLines = (clusters, coverageM) =>
  computeMeshLines(clusters, coverageM).map((line) => ({
    ...line,
    color: CLUSTER_PALETTE[line.clusterIdx % CLUSTER_PALETTE.length],
  }));

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

const sortByTime = (a, b) => new Date(b.last_event_at || b.created_at || 0) - new Date(a.last_event_at || a.created_at || 0);
const sortByUrgencyThenTime = (a, b) => {
  const ua = URGENCY_ORDER[a.max_urgency] ?? 0;
  const ub = URGENCY_ORDER[b.max_urgency] ?? 0;
  if (ua !== ub) return ub - ua;
  return sortByTime(a, b);
};

const URGENCY_TIERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const groupByUrgency = (incidents) => {
  const groups = new Map(URGENCY_TIERS.map((u) => [u, []]));
  groups.set('OTHER', []);
  incidents.forEach((i) => {
    const tier = URGENCY_TIERS.includes(i.max_urgency) ? i.max_urgency : 'OTHER';
    groups.get(tier).push(i);
  });
  // Sort within each group by time (newest first)
  groups.forEach((arr) => arr.sort(sortByTime));
  return groups;
};

const fromNowSafe = (ts) => (ts ? dayjs(ts).fromNow() : '—');

// ---- Subcomponents ---------------------------------------------------------

const UrgencySectionHeader = ({ tier, count, collapsed, onToggle }) => {
  const color = URGENCY_COLORS[tier] || '#9e9e9e';
  const label = URGENCY_LABELS[tier] || tier;
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      onClick={onToggle}
      sx={{
        px: 1,
        py: 0.5,
        position: 'sticky',
        top: 0,
        zIndex: 1,
        cursor: 'pointer',
        userSelect: 'none',
        bgcolor: 'background.default',
        borderBottom: `1px solid ${alpha(color, 0.3)}`,
        '&:hover': { bgcolor: alpha(color, 0.05) },
      }}
    >
      <Box sx={{ width: 4, height: 14, borderRadius: 1, bgcolor: color }} />
      <Typography
        variant="overline"
        sx={{ fontWeight: 700, color, letterSpacing: 0.6, lineHeight: 1.2 }}
      >
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        ({count})
      </Typography>
      <Box sx={{ flex: 1 }} />
      {collapsed ? <ExpandMoreIcon fontSize="small" sx={{ color }} /> : <ExpandLessIcon fontSize="small" sx={{ color }} />}
    </Stack>
  );
};

const CompactStatsStrip = ({ incidents }) => {
  const counts = useMemo(() => {
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    incidents.forEach((i) => {
      if (i.max_urgency in c) c[i.max_urgency] += 1;
    });
    return c;
  }, [incidents]);

  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      sx={{ display: { xs: 'none', md: 'flex' } }}
    >
      {URGENCY_TIERS.map((u) => (
        <Tooltip key={u} title={URGENCY_LABELS[u]} arrow>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{
              px: 1,
              py: 0.5,
              borderRadius: 1,
              border: `1px solid ${alpha(URGENCY_COLORS[u], 0.4)}`,
              bgcolor: alpha(URGENCY_COLORS[u], 0.08),
            }}
          >
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: URGENCY_COLORS[u] }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: URGENCY_COLORS[u], minWidth: 14 }}>
              {counts[u]}
            </Typography>
          </Stack>
        </Tooltip>
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
  const summary = incident.auto_summary || `Olay ${incident.id?.slice(0, 8)}`;
  const cats = (incident.categories || []).slice(0, 3);
  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        borderLeft: `3px solid ${color}`,
        bgcolor: isSelected ? alpha(color, 0.08) : 'background.paper',
        boxShadow: isSelected ? `0 0 0 2px ${color}` : 'none',
        transition: 'background-color 0.12s, box-shadow 0.12s',
        '&:hover': { bgcolor: alpha(color, 0.04) },
      }}
    >
      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {summary}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {fromNowSafe(incident.last_event_at || incident.created_at)}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" sx={{ pl: 2 }}>
          {cats.map((c) => (
            <CategoryChip key={c} code={c} />
          ))}
          <VulnerableSignals incident={incident} />
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <GroupIcon sx={{ fontSize: 13, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">
              {incident.n_messages ?? 0}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

const IncidentMessages = ({ incidentId, color, onMessageClick }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!incidentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getIncidentMessages(incidentId)
      .then((data) => {
        if (!cancelled) setMessages(data.messages || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Mesajlar alınamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [incidentId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }
  if (error) {
    return <Typography variant="caption" color="error">{error}</Typography>;
  }
  if (messages.length === 0) {
    return <Typography variant="caption" color="text.secondary">Mesaj bulunamadı.</Typography>;
  }

  return (
    <Stack spacing={1}>
      {messages.map((m) => (
        <Card
          key={m.id}
          variant="outlined"
          sx={{
            borderLeft: `3px solid ${color}`,
            bgcolor: alpha(color, 0.03),
          }}
        >
          <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.75, lineHeight: 1.4 }}>
              "{m.text || '(boş mesaj)'}"
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <RouterIcon sx={{ fontSize: 13, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">
                  {m.gatewayName}
                </Typography>
              </Stack>
              {m.sourceUserName && (
                <Typography variant="caption" color="text.secondary">
                  · {m.sourceUserName}
                </Typography>
              )}
              <SourceBadge
                source={m.source}
                hops={m.meshHops}
                srcAddr={m.meshSrcAddr}
                msgId={m.meshMsgId}
                onClick={onMessageClick ? () => onMessageClick(m) : undefined}
              />
              <Box sx={{ flex: 1 }} />
              {m.type && m.type !== 'manual_message' && (
                <Chip label={m.type.toUpperCase()} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
              )}
              <Typography variant="caption" color="text.secondary">
                {fromNowSafe(m.receivedAt)}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
};

const IncidentDetail = ({ incident, onBack, sourceGateway, onClosed, onMessageClick }) => {
  const color = URGENCY_COLORS[incident.max_urgency] || '#9e9e9e';
  const [closeOpen, setCloseOpen] = useState(false);
  const [falseAlarm, setFalseAlarm] = useState(false);
  const [closing, setClosing] = useState(false);
  const isOpen = (incident.status || '').toLowerCase() === 'open';

  const doClose = async () => {
    setClosing(true);
    try {
      await closeIncident(incident.id, falseAlarm);
      setCloseOpen(false);
      setFalseAlarm(false);
      if (onClosed) onClosed();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Olay kapatılamadı');
    } finally {
      setClosing(false);
    }
  };

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
          {isOpen && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={() => setCloseOpen(true)}
              sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.32)' } }}
            >
              Kapat
            </Button>
          )}
        </Stack>
      </Box>

      <Dialog open={closeOpen} onClose={() => !closing && setCloseOpen(false)}>
        <DialogTitle>Olayı kapat</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            "{incident.auto_summary || incident.id}" olayını kapatmak üzeresiniz.
            Açık olay listesinden kalkacak ve haritada gösterilmeyecek.
          </DialogContentText>
          <FormControlLabel
            control={<Checkbox checked={falseAlarm} onChange={(e) => setFalseAlarm(e.target.checked)} />}
            label="Yanlış alarm olarak işaretle"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloseOpen(false)} disabled={closing}>İptal</Button>
          <Button onClick={doClose} variant="contained" color="error" disabled={closing}>
            {closing ? 'Kapatılıyor...' : 'Kapat'}
          </Button>
        </DialogActions>
      </Dialog>
      <CardContent sx={{ flex: 1 }}>
        <Typography variant="body1" fontWeight={500} sx={{ mb: 2 }}>
          {incident.auto_summary || `Olay ${incident.id?.slice(0, 8)}`}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
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

        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
          <ChatBubbleOutlineIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
          <Typography variant="caption" color="text.secondary">
            ORİJİNAL MESAJLAR ({incident.n_messages})
          </Typography>
          {onMessageClick && (
            <Typography
              variant="caption"
              sx={{ color, fontWeight: 600, ml: 'auto' }}
            >
              "Mesh · sıçrama" rozetine tıkla → yolu izle
            </Typography>
          )}
        </Stack>
        <Box sx={{ mb: 2 }}>
          <IncidentMessages
            incidentId={incident.id}
            color={color}
            onMessageClick={onMessageClick}
          />
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          MESAJ DAĞILIMI ({incident.n_messages} toplam)
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Chip label={`${incident.n_self_reports} self`} size="small" variant="outlined" />
          <Chip label={`${incident.n_witness_reports} tanık`} size="small" variant="outlined" />
          <Chip label={`${incident.n_info} bilgi`} size="small" variant="outlined" />
        </Stack>

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
                      bgcolor: sourceGateway.status === 'inactive'
                        ? GATEWAY_INACTIVE_COLOR
                        : sourceGateway.status === 'low_battery' ? '#ef6c00' : '#2e7d32',
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [incidents, setIncidents] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [listOpen, setListOpen] = useState(true);
  // Per-tier collapse state. CRITICAL/HIGH default open, MEDIUM/LOW collapsed
  // when there are many incidents to keep the panel scannable.
  const [collapsedTiers, setCollapsedTiers] = useState({ MEDIUM: false, LOW: false, OTHER: true });
  // Mesh-hop animation state. `key` doubles as the React key so bumping it
  // re-triggers the rAF loop inside MeshHopAnimation.
  const [hopAnimation, setHopAnimation] = useState(null);

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
    return [...incidents].sort(sortByUrgencyThenTime);
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return incidents;
    return incidents.filter((i) => {
      const summary = (i.auto_summary || '').toLowerCase();
      const cats = (i.categories || []).map((c) => (CATEGORY_LABELS[c] || c).toLowerCase());
      return summary.includes(q) || cats.some((c) => c.includes(q));
    });
  }, [incidents, searchQuery]);

  const incidentGroups = useMemo(() => groupByUrgency(filteredIncidents), [filteredIncidents]);

  const toggleTier = useCallback(
    (tier) => setCollapsedTiers((prev) => ({ ...prev, [tier]: !prev[tier] })),
    []
  );

  const selectedIncident = selectedId ? incidents.find((i) => i.id === selectedId) : null;
  const sourceGateway = useMemo(
    () => findGatewayForIncident(selectedIncident, gateways),
    [selectedIncident, gateways]
  );

  const mapItems = sortedIncidents
    .filter((i) => i.centroid?.lat != null && i.centroid?.lng != null)
    .map(incidentToGatewayShape);

  const colorResolver = (item) => URGENCY_COLORS[item.urgency] || '#9e9e9e';

  // Cluster the active gateways. Each gateway gets a color based on which
  // connected component it belongs to (singletons get the isolated color).
  const clusters = useMemo(() => computeClusters(gateways, DEFAULT_COVERAGE_M), [gateways]);

  // Map of gateway._id -> {clusterIdx, color, isIsolated}
  const gatewayMeta = useMemo(() => {
    const m = new Map();
    clusters.forEach((cluster, idx) => {
      const color = colorForCluster(idx, cluster.length);
      cluster.forEach((g) => m.set(g._id, { clusterIdx: idx, color, isIsolated: cluster.length <= 1 }));
    });
    return m;
  }, [clusters]);

  // Background gateway markers — colored by cluster membership.
  const extraMarkers = useMemo(
    () =>
      gateways
        .filter((g) => g.location?.lat != null && g.location?.lng != null)
        .map((g) => {
          const meta = gatewayMeta.get(g._id);
          const color = g.status === 'inactive' ? GATEWAY_INACTIVE_COLOR : meta?.color || GATEWAY_ISOLATED_COLOR;
          return {
            id: g._id,
            lat: g.location.lat,
            lng: g.location.lng,
            color,
            radius: 6,
            opacity: 0.95,
            fillOpacity: g.status === 'inactive' ? 0.25 : 0.7,
            label: g.name || g.serialNumber || 'Gateway',
            subtitle: meta?.isIsolated
              ? `İZOLE — Pil: %${g.battery ?? '?'} · Sinyal: ${g.signal_quality}`
              : `Durum: ${g.status} · Pil: %${g.battery ?? '?'} · Sinyal: ${g.signal_quality}`,
            highlighted: sourceGateway && sourceGateway._id === g._id,
          };
        }),
    [gateways, gatewayMeta, sourceGateway]
  );

  // Coverage circles per gateway, color-matched to cluster.
  const coverageCircles = useMemo(
    () =>
      gateways
        .filter((g) => g.location?.lat != null && g.location?.lng != null && g.status !== 'inactive')
        .map((g) => {
          const meta = gatewayMeta.get(g._id);
          return {
            lat: g.location.lat,
            lng: g.location.lng,
            radiusMeters: COVERAGE_DISPLAY_M,
            color: meta?.color || GATEWAY_ISOLATED_COLOR,
            fillOpacity: meta?.isIsolated ? 0.12 : 0.08,
            opacity: 0.55,
          };
        }),
    [gateways, gatewayMeta]
  );

  const meshLines = useMemo(() => colorMeshLines(clusters, DEFAULT_COVERAGE_M), [clusters]);

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

  // On mobile, opening a detail panel covers the whole screen. Keep list
  // closed when a detail is open to avoid stacking confusion.
  const showListPanel = listOpen && (!isMobile || !selectedIncident);
  const connectedClusters = clusters.filter((c) => c.length >= 2).length;
  const isolatedClusters = clusters.filter((c) => c.length === 1).length;

  const handleSelect = (id) => {
    setSelectedId(id);
    setHopAnimation(null);
    if (isMobile) setListOpen(false);
  };

  // Triggered when the operator clicks the "Mesh · N sıçrama" badge in the
  // message detail panel. Synthesizes the hop chain from the source gateway's
  // cluster and kicks off the MeshHopAnimation overlay for ~5s. Map zoom/
  // pan is intentionally untouched so the operator's framing survives the
  // animation playback.
  const handleMessageClick = useCallback(
    (message) => {
      if (!sourceGateway || !selectedIncident) return;
      const path = synthesizeHopPath({
        sourceGateway,
        gateways,
        meshHops: message?.meshHops ?? 1,
        clusters,
      });
      if (!path || path.length < 2) return;
      setHopAnimation({
        path,
        color: URGENCY_COLORS[selectedIncident.max_urgency] || '#1976d2',
        durationMs: 5000,
        animationKey: Date.now(),
      });
    },
    [sourceGateway, selectedIncident, gateways, clusters]
  );

  return (
    <Box sx={{ position: 'relative', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Full-bleed map background */}
      <Box sx={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <MapComponent
          gateways={mapItems}
          /* selectedGateway intentionally NOT passed — selection would
             otherwise auto-pan + auto-zoom the map (MapUpdater), undoing
             whatever framing the operator has set up for the demo shot. */
          onMarkerClick={(item) => handleSelect(item._id)}
          loading={loading}
          error={null}
          isRefreshing={isRefreshing}
          colorResolver={colorResolver}
          extraMarkers={extraMarkers}
          lines={allLines}
          coverageCircles={coverageCircles}
          hopAnimation={hopAnimation}
        />
      </Box>

      {/* Floating top-right toolbar — auto-width pill so it doesn't waste
          horizontal real estate when there's little to show. */}
      <Paper
        elevation={3}
        sx={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 4,
          py: 0.5,
          px: 1,
          borderRadius: 999,
          bgcolor: alpha(theme.palette.background.paper, 0.96),
          backdropFilter: 'blur(8px)',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <CompactStatsStrip incidents={incidents} />

          {lastUpdate && (
            <Tooltip title={`Son güncelleme: ${dayjs(lastUpdate).format('HH:mm:ss')}`}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={0.5}
                sx={{ display: { xs: 'none', sm: 'flex' } }}
              >
                <AccessTimeIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  {fromNowSafe(lastUpdate)}
                </Typography>
              </Stack>
            </Tooltip>
          )}
          <Tooltip title="Yenile">
            <IconButton size="small" onClick={() => loadIncidents(false)} disabled={isRefreshing}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      {error && (
        <MuiAlert
          severity="error"
          sx={{ position: 'absolute', top: 70, left: 12, right: 12, zIndex: 4 }}
        >
          {error}
        </MuiAlert>
      )}

      {/* Network coverage callout — bottom edge, offset past the list panel
          so it never sits underneath. */}
      {clusters.length > 0 && (
        <Paper
          elevation={2}
          sx={{
            position: 'absolute',
            bottom: 12,
            left: { xs: 12, sm: showListPanel ? 364 : 12, md: showListPanel ? 384 : 12 },
            zIndex: 2,
            transition: 'left 0.2s',
            px: 1.25,
            py: 0.75,
            borderRadius: 1.5,
            bgcolor: alpha(theme.palette.background.paper, 0.92),
            backdropFilter: 'blur(6px)',
            display: { xs: 'none', sm: 'block' },
            maxWidth: 320,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}
            >
              Ağ
            </Typography>
            <Chip
              size="small"
              label={`${connectedClusters} bağlı`}
              sx={{
                height: 20,
                bgcolor: alpha(CLUSTER_PALETTE[0], 0.15),
                color: CLUSTER_PALETTE[0],
                fontWeight: 700,
              }}
            />
            {isolatedClusters > 0 && (
              <Chip
                size="small"
                label={`${isolatedClusters} izole`}
                sx={{
                  height: 20,
                  bgcolor: alpha(GATEWAY_ISOLATED_COLOR, 0.15),
                  color: GATEWAY_ISOLATED_COLOR,
                  fontWeight: 700,
                }}
              />
            )}
            <Typography variant="caption" color="text.secondary">
              {DEFAULT_COVERAGE_M}m
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Floating list panel — full height like a Google Maps sidebar */}
      {showListPanel && (
        <Paper
          elevation={6}
          sx={{
            position: 'absolute',
            left: 12,
            top: 12,
            bottom: 12,
            zIndex: 3,
            width: { xs: 'calc(100vw - 24px)', sm: 340, md: 360 },
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: alpha(theme.palette.background.paper, 0.97),
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* Panel title + close */}
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            sx={{ px: 1.5, pt: 1.25, pb: 0.75 }}
          >
            <ReportProblemIcon color="error" sx={{ fontSize: 18 }} />
            <Typography variant="subtitle2" fontWeight={700}>
              Olay Listesi
            </Typography>
            <Chip
              label={incidents.length}
              size="small"
              color="error"
              sx={{ height: 18, minWidth: 24, fontWeight: 700, fontSize: '0.7rem' }}
            />
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Listeyi gizle">
              <IconButton size="small" onClick={() => setListOpen(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          {/* Search */}
          <Box sx={{ px: 1, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Olaylarda ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery('')}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />
          </Box>

          {/* Scrollable list body */}
          <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress size={24} />
              </Box>
            )}
            {!loading && filteredIncidents.length === 0 && (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {searchQuery ? 'Aramanla eşleşen olay yok.' : 'Bu filtre için olay yok.'}
                </Typography>
              </Box>
            )}
            {!loading &&
              [...URGENCY_TIERS, 'OTHER'].map((tier) => {
                const items = incidentGroups.get(tier) || [];
                if (items.length === 0) return null;
                const isCollapsed = !!collapsedTiers[tier];
                return (
                  <Box key={tier} sx={{ mb: 1.5 }}>
                    <UrgencySectionHeader
                      tier={tier}
                      count={items.length}
                      collapsed={isCollapsed}
                      onToggle={() => toggleTier(tier)}
                    />
                    <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
                      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                        {items.map((incident) => (
                          <IncidentCard
                            key={incident.id}
                            incident={incident}
                            isSelected={selectedId === incident.id}
                            onClick={() => handleSelect(incident.id)}
                          />
                        ))}
                      </Stack>
                    </Collapse>
                  </Box>
                );
              })}
          </Box>
        </Paper>
      )}

      {/* Floating "open list" FAB when list is hidden */}
      {!showListPanel && (
        <Tooltip title="Olay listesini aç">
          <Fab
            size="medium"
            color="primary"
            onClick={() => setListOpen(true)}
            sx={{ position: 'absolute', left: 12, top: 12, zIndex: 3 }}
          >
            <Badge badgeContent={incidents.length} color="error" max={99}>
              <FormatListBulletedIcon />
            </Badge>
          </Fab>
        </Tooltip>
      )}

      {/* Floating detail panel */}
      {selectedIncident && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            top: 76,
            bottom: 12,
            right: 12,
            // detail panel sits below header so they don't overlap
            left: { xs: 12, sm: 'auto' },
            width: { xs: 'auto', sm: 380, md: 420 },
            zIndex: 5,
            borderRadius: 2,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <IncidentDetail
            incident={selectedIncident}
            onBack={() => setSelectedId(null)}
            sourceGateway={sourceGateway}
            onClosed={() => {
              setSelectedId(null);
              loadIncidents(false);
            }}
            onMessageClick={handleMessageClick}
          />
        </Paper>
      )}
    </Box>
  );
};

export default Incidents;
