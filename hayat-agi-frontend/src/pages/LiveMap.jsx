// Cihaz Sağlığı (Fleet Health). Map-hero layout that works at any fleet
// size: actionable info always visible, statistical histograms hide
// behind a collapsible accordion so they don't dominate when there are
// only a handful of devices.
//
// File name kept so the existing /dashboard/harita route still resolves.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Container,
  Grid,
  Typography,
  Paper,
  Stack,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Tooltip,
  IconButton,
  Divider,
  alpha,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useTheme,
} from '@mui/material';
import RouterIcon from '@mui/icons-material/Router';
import RefreshIcon from '@mui/icons-material/Refresh';
import BatteryStdIcon from '@mui/icons-material/BatteryStd';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import HubIcon from '@mui/icons-material/Hub';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import MapComponent from '../components/MapComponent';
import { getGateways } from '../api/gatewayService';
import {
  DEFAULT_COVERAGE_M,
  computeClusters,
  computeMeshLines,
  suggestRelayPlacements,
} from '../utils/meshTopology';

// Visual-only coverage radius for the on-map circles. Cluster/mesh-line math
// keeps using the realistic DEFAULT_COVERAGE_M (350m). Mirrors the same
// pattern used in Incidents.jsx so the two map views look consistent.
const COVERAGE_DISPLAY_M = 50;
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/tr';

dayjs.extend(relativeTime);
dayjs.locale('tr');

// ---- Tokens ----------------------------------------------------------------

const STATUS_COLORS = {
  active: '#2e7d32',
  inactive: '#9e9e9e',
  low_battery: '#ed6c02',
};

const STATUS_LABELS = {
  active: 'Aktif',
  inactive: 'Pasif',
  low_battery: 'Düşük Pil',
};

const SIGNAL_LABELS = { strong: 'Güçlü', medium: 'Orta', weak: 'Zayıf', none: 'Yok' };
const SIGNAL_COLORS = { strong: '#2e7d32', medium: '#ed6c02', weak: '#d32f2f', none: '#9e9e9e' };

const CLUSTER_PALETTE = ['#1976d2', '#388e3c', '#7b1fa2', '#0097a7', '#c2185b', '#5d4037', '#455a64', '#f9a825'];
const ISOLATED_COLOR = '#ef6c00';
const RELAY_GHOST_COLOR = '#9c27b0';
const HEARTBEAT_STALE_THRESHOLD_MS = 90_000; // matches backend HEARTBEAT_TIMEOUT_MS

// ---- Slim metric chip ------------------------------------------------------

const MetricChip = ({ label, value, color }) => (
  <Stack
    direction="row"
    alignItems="center"
    spacing={0.75}
    sx={{
      px: 1.25,
      py: 0.5,
      borderRadius: 1.25,
      border: `1px solid ${alpha(color, 0.4)}`,
      bgcolor: alpha(color, 0.07),
    }}
  >
    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color }} />
    <Typography variant="body2" sx={{ fontWeight: 700, color, lineHeight: 1, minWidth: 16 }}>
      {value}
    </Typography>
    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1, fontWeight: 600 }}>
      {label}
    </Typography>
  </Stack>
);

// ---- Map card --------------------------------------------------------------

const MeshTopologyCard = ({ gateways, clusters, relaySuggestions }) => {
  const colorForCluster = (idx, size) =>
    size <= 1 ? ISOLATED_COLOR : CLUSTER_PALETTE[idx % CLUSTER_PALETTE.length];

  const gatewayMeta = useMemo(() => {
    const m = new Map();
    clusters.forEach((cluster, idx) => {
      const color = colorForCluster(idx, cluster.length);
      cluster.forEach((g) => m.set(g._id, { color, isIsolated: cluster.length <= 1 }));
    });
    return m;
  }, [clusters]);

  const extraMarkers = useMemo(() => {
    const markers = gateways
      .filter((g) => g.location?.lat != null && g.location?.lng != null)
      .map((g) => {
        const meta = gatewayMeta.get(g._id);
        const color = g.status === 'inactive' ? STATUS_COLORS.inactive : meta?.color || ISOLATED_COLOR;
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
            ? `İZOLE — bağlantı yok`
            : `${STATUS_LABELS[g.status] || g.status} · %${g.battery ?? '?'}`,
        };
      });
    relaySuggestions.forEach((s, idx) => {
      s.segments.forEach((p, pIdx) => {
        markers.push({
          id: `relay-${idx}-${pIdx}`,
          lat: p.lat,
          lng: p.lng,
          color: RELAY_GHOST_COLOR,
          radius: 7,
          opacity: 0.85,
          fillOpacity: 0.25,
          label: 'Önerilen röle konumu',
          subtitle: s.reason,
        });
      });
    });
    return markers;
  }, [gateways, gatewayMeta, relaySuggestions]);

  const meshLines = useMemo(() => {
    const lines = computeMeshLines(clusters, DEFAULT_COVERAGE_M).map((line) => ({
      ...line,
      color: CLUSTER_PALETTE[line.clusterIdx % CLUSTER_PALETTE.length],
    }));
    relaySuggestions.forEach((s) => {
      if (s.infeasible || s.segments.length === 0) return;
      const path = [s.from.location, ...s.segments, s.to.location];
      for (let i = 0; i < path.length - 1; i += 1) {
        lines.push({
          from: [path[i].lat, path[i].lng],
          to: [path[i + 1].lat, path[i + 1].lng],
          color: RELAY_GHOST_COLOR,
          weight: 2,
          opacity: 0.75,
          dashArray: '6 4',
        });
      }
    });
    return lines;
  }, [clusters, relaySuggestions]);

  // Cover circles for ALL gateways including inactive — operators need to
  // see the registered footprint while planning relays, not just the
  // currently-live nodes. Inactive ones render dimmer.
  const coverageCircles = useMemo(
    () =>
      gateways
        .filter((g) => g.location?.lat != null && g.location?.lng != null)
        .map((g) => {
          const meta = gatewayMeta.get(g._id);
          const isInactive = g.status === 'inactive';
          const color = isInactive ? STATUS_COLORS.inactive : meta?.color || ISOLATED_COLOR;
          return {
            lat: g.location.lat,
            lng: g.location.lng,
            radiusMeters: COVERAGE_DISPLAY_M,
            color,
            fillOpacity: isInactive ? 0.05 : meta?.isIsolated ? 0.12 : 0.08,
            opacity: isInactive ? 0.3 : 0.55,
          };
        }),
    [gateways, gatewayMeta]
  );

  const mapItems = gateways.map((g) => ({
    _id: g._id,
    name: g.name,
    status: g.status,
    battery: g.battery,
    location: g.location,
  }));

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ pb: 1, pt: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <HubIcon color="action" fontSize="small" />
          <Typography variant="subtitle2" fontWeight={700}>
            Ağ Topolojisi
          </Typography>
          <Box sx={{ flex: 1 }} />
        </Stack>
      </CardContent>
      <Box sx={{ flex: 1, minHeight: 480, position: 'relative' }}>
        <MapComponent
          gateways={mapItems}
          extraMarkers={extraMarkers}
          lines={meshLines}
          coverageCircles={coverageCircles}
          loading={false}
          error={null}
        />
      </Box>
    </Card>
  );
};

// ---- Alerts panel ----------------------------------------------------------

const AlertsPanel = ({ gateways, clusters, relaySuggestions }) => {
  const items = useMemo(() => {
    const list = [];
    const now = Date.now();

    // Low battery devices
    gateways
      .filter((g) => g.battery != null && g.battery < 20 && g.status !== 'inactive')
      .forEach((g) => {
        list.push({
          severity: 'warning',
          icon: BatteryStdIcon,
          title: g.name || g.serialNumber,
          message: `Batarya %${g.battery}`,
          time: g.last_seen,
        });
      });

    // Isolated active devices (singleton clusters)
    clusters
      .filter((c) => c.length === 1)
      .forEach((c) => {
        const g = c[0];
        list.push({
          severity: 'warning',
          icon: HubIcon,
          title: g.name || g.serialNumber,
          message: 'İzole — mesh bağlantısı yok',
          time: g.last_seen,
        });
      });

    // Stale heartbeats — registered but never seen, or last_seen older than threshold
    gateways
      .filter((g) => {
        if (!g.last_seen) return true;
        return now - new Date(g.last_seen).getTime() > HEARTBEAT_STALE_THRESHOLD_MS;
      })
      .forEach((g) => {
        list.push({
          severity: 'error',
          icon: ErrorOutlineIcon,
          title: g.name || g.serialNumber,
          message: g.last_seen
            ? `Son heartbeat ${dayjs(g.last_seen).fromNow()}`
            : 'Hiç heartbeat alınmadı',
          time: g.last_seen,
        });
      });

    // Relay suggestions
    relaySuggestions.forEach((s) => {
      list.push({
        severity: 'info',
        icon: LightbulbOutlinedIcon,
        title: `${s.from.name || s.from.serialNumber} → ${s.to.name || s.to.serialNumber}`,
        message: `${(s.distance / 1000).toFixed(2)} km · ${s.reason}`,
        time: null,
        suggestion: s,
      });
    });

    return list;
  }, [gateways, clusters, relaySuggestions]);

  const SEVERITY_COLORS = {
    error: '#d32f2f',
    warning: '#ed6c02',
    info: RELAY_GHOST_COLOR,
  };

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ pb: 1, pt: 1.25, flex: 1, overflow: 'auto' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <WarningAmberIcon color="action" fontSize="small" />
          <Typography variant="subtitle2" fontWeight={700}>
            Uyarılar & Öneriler
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={items.length} sx={{ height: 20, fontWeight: 700 }} />
        </Stack>

        {items.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Tüm cihazlar sağlıklı.
            </Typography>
            <Typography variant="caption" color="text.disabled">
              Düşük pil, izole node veya heartbeat eksiği yok.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1} divider={<Divider flexItem />}>
            {items.map((it, idx) => {
              const color = SEVERITY_COLORS[it.severity];
              const Icon = it.icon;
              return (
                <Stack
                  key={idx}
                  direction="row"
                  spacing={1}
                  alignItems="flex-start"
                  sx={{ py: 0.5 }}
                >
                  <Box
                    sx={{
                      mt: 0.25,
                      width: 24,
                      height: 24,
                      borderRadius: 1,
                      bgcolor: alpha(color, 0.12),
                      color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon sx={{ fontSize: 14 }} />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {it.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {it.message}
                    </Typography>
                    {it.suggestion?.segments?.length > 0 && (
                      <Typography
                        variant="caption"
                        color="text.disabled"
                        sx={{ display: 'block', fontFamily: 'monospace', fontSize: '0.65rem' }}
                      >
                        {it.suggestion.segments
                          .map((p, i) => `R${i + 1}: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`)
                          .join(' · ')}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

// ---- Detail histograms (collapsible) ---------------------------------------

const BatteryDistribution = ({ gateways }) => {
  const buckets = useMemo(() => {
    const b = [
      { label: '0–20%', min: 0, max: 20, color: '#d32f2f', count: 0 },
      { label: '20–40%', min: 20, max: 40, color: '#ed6c02', count: 0 },
      { label: '40–60%', min: 40, max: 60, color: '#f9a825', count: 0 },
      { label: '60–80%', min: 60, max: 80, color: '#7cb342', count: 0 },
      { label: '80–100%', min: 80, max: 101, color: '#2e7d32', count: 0 },
    ];
    gateways.forEach((g) => {
      const v = g.battery ?? 0;
      const bucket = b.find((x) => v >= x.min && v < x.max) || b[b.length - 1];
      bucket.count += 1;
    });
    return b;
  }, [gateways]);
  const total = gateways.length || 1;
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Batarya
      </Typography>
      {buckets.map((b) => (
        <Box key={b.label}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
            <Typography variant="caption" sx={{ color: b.color, fontWeight: 600 }}>{b.label}</Typography>
            <Typography variant="caption" color="text.secondary">{b.count}</Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(b.count / total) * 100}
            sx={{ height: 5, borderRadius: 3, bgcolor: alpha(b.color, 0.12), '& .MuiLinearProgress-bar': { bgcolor: b.color, borderRadius: 3 } }}
          />
        </Box>
      ))}
    </Stack>
  );
};

const SignalBreakdown = ({ gateways }) => {
  const counts = useMemo(() => {
    const c = { strong: 0, medium: 0, weak: 0, none: 0 };
    gateways.forEach((g) => {
      const k = g.signal_quality || 'none';
      if (k in c) c[k] += 1;
    });
    return c;
  }, [gateways]);
  const total = gateways.length || 1;
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Sinyal
      </Typography>
      {['strong', 'medium', 'weak', 'none'].map((k) => (
        <Box key={k}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
            <Typography variant="caption" sx={{ color: SIGNAL_COLORS[k], fontWeight: 600 }}>{SIGNAL_LABELS[k]}</Typography>
            <Typography variant="caption" color="text.secondary">{counts[k]}</Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(counts[k] / total) * 100}
            sx={{ height: 5, borderRadius: 3, bgcolor: alpha(SIGNAL_COLORS[k], 0.12), '& .MuiLinearProgress-bar': { bgcolor: SIGNAL_COLORS[k], borderRadius: 3 } }}
          />
        </Box>
      ))}
    </Stack>
  );
};

// ---- Page ------------------------------------------------------------------

const FleetHealth = () => {
  const theme = useTheme();
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (initial = false) => {
    try {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const data = await getGateways();
      setGateways(data || []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Cihazlar yüklenemedi');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(false), 5000);
    return () => clearInterval(id);
  }, [load]);

  const counts = useMemo(() => {
    const c = { total: gateways.length, active: 0, inactive: 0, low_battery: 0 };
    gateways.forEach((g) => {
      if (g.status === 'active') c.active += 1;
      else if (g.status === 'low_battery') c.low_battery += 1;
      else c.inactive += 1;
    });
    return c;
  }, [gateways]);

  const clusters = useMemo(() => computeClusters(gateways, DEFAULT_COVERAGE_M), [gateways]);
  const relaySuggestions = useMemo(() => suggestRelayPlacements(gateways, DEFAULT_COVERAGE_M), [gateways]);
  const isolatedCount = clusters.filter((c) => c.length === 1).length;

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      {/* Slim toolbar */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        sx={{ mb: 2, flexWrap: 'wrap' }}
      >
        <Typography variant="h6" fontWeight={700} color="primary" sx={{ mr: 1 }}>
          Cihaz Sağlığı
        </Typography>

        <MetricChip label="Toplam" value={counts.total} color="#1976d2" />
        <MetricChip label="Aktif" value={counts.active} color={STATUS_COLORS.active} />
        <MetricChip label="Düşük Pil" value={counts.low_battery} color={STATUS_COLORS.low_battery} />
        <MetricChip label="Pasif" value={counts.inactive} color={STATUS_COLORS.inactive} />
        {isolatedCount > 0 && (
          <MetricChip label="İzole" value={isolatedCount} color={ISOLATED_COLOR} />
        )}

        <Box sx={{ flex: 1 }} />
        {lastUpdate && (
          <Typography variant="caption" color="text.secondary">
            {dayjs(lastUpdate).fromNow()}
          </Typography>
        )}
        <Tooltip title="Yenile">
          <IconButton size="small" onClick={() => load(false)} disabled={refreshing}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && (
        <Paper sx={{ p: 1.5, mb: 2, bgcolor: alpha(theme.palette.error.main, 0.08), color: 'error.main', border: `1px solid ${alpha(theme.palette.error.main, 0.3)}` }}>
          <Typography variant="body2">{error}</Typography>
        </Paper>
      )}

      {/* Hero: map + alerts */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Box sx={{ height: 'calc(100vh - 200px)', minHeight: 520 }}>
            <MeshTopologyCard gateways={gateways} clusters={clusters} relaySuggestions={relaySuggestions} />
          </Box>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ height: 'calc(100vh - 200px)', minHeight: 520 }}>
            <AlertsPanel gateways={gateways} clusters={clusters} relaySuggestions={relaySuggestions} />
          </Box>
        </Grid>
      </Grid>

      {/* Detail histograms — collapsed by default; useful at scale */}
      <Accordion sx={{ mt: 2, '&:before': { display: 'none' } }} variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle2" fontWeight={700}>
              Detaylı İstatistikler
            </Typography>
            <Typography variant="caption" color="text.secondary">
              · batarya ve sinyal dağılımı
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <BatteryDistribution gateways={gateways} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <SignalBreakdown gateways={gateways} />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>
    </Container>
  );
};

export default FleetHealth;
