import React, { useState, useEffect } from 'react';
import {
    Container,
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Paper,
    IconButton,
    Stack,
    TextField,
    MenuItem,
    InputAdornment,
    Chip,
    Box,
    LinearProgress,
    Tooltip,
    alpha,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import AddIcon from '@mui/icons-material/Add';
import RouterIcon from '@mui/icons-material/Router';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PersonIcon from '@mui/icons-material/Person';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import { Link } from 'react-router-dom';
import { getGateways, deleteGateway } from '../api/gatewayService';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/tr';

dayjs.extend(relativeTime);
dayjs.locale('tr');

const STATUS_META = {
    active: { label: 'Aktif', color: 'success' },
    inactive: { label: 'Pasif', color: 'default' },
    low_battery: { label: 'Düşük Pil', color: 'warning' },
};

const SIGNAL_META = {
    strong: { label: 'Güçlü', color: '#2e7d32' },
    medium: { label: 'Orta', color: '#ed6c02' },
    weak: { label: 'Zayıf', color: '#d32f2f' },
};

const formatAddress = (addr) => {
    if (!addr) return '—';
    const parts = [addr.neighborhood, addr.district, addr.province].filter(Boolean);
    return parts.length ? parts.join(', ') : '—';
};

const formatOwner = (owner) => {
    if (!owner) return '—';
    if (typeof owner === 'string') return owner.slice(0, 8);
    const name = [owner.name, owner.surname].filter(Boolean).join(' ');
    return name || owner.email || '—';
};

const batteryColor = (b) => {
    if (b == null) return '#9e9e9e';
    if (b >= 50) return '#2e7d32';
    if (b >= 20) return '#ed6c02';
    return '#d32f2f';
};

const GatewayManager = () => {
    const [gateways, setGateways] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const data = await getGateways();
            setGateways(data);
        } catch (error) {
            console.error('Veri yüklenemedi', error);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Bu cihazı silmek istediğinize emin misiniz?')) {
            await deleteGateway(id);
            loadData();
        }
    };

    const filteredGateways = gateways.filter((gw) => {
        const term = searchTerm.toLowerCase();
        if (term) {
            const haystack = [
                gw.name,
                gw.serialNumber,
                gw.address?.province,
                gw.address?.district,
                gw.address?.neighborhood,
                formatOwner(gw.owner),
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            if (!haystack.includes(term)) return false;
        }
        if (statusFilter !== 'all' && gw.status !== statusFilter) return false;
        return true;
    });

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={2}
                sx={{ mb: 3 }}
            >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Typography variant="h4" fontWeight="bold" color="primary">
                        Cihaz Yönetimi
                    </Typography>
                    <Chip label={gateways.length} color="primary" sx={{ fontWeight: 700 }} />
                </Stack>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    component={Link}
                    to="/dashboard/add-gateway"
                    sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 'bold' }}
                >
                    Yeni Cihaz Ekle
                </Button>
            </Stack>

            <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }} elevation={0} variant="outlined">
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                        placeholder="Ad, seri no, mahalle, ilçe veya sahip ara..."
                        size="small"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                        sx={{ flexGrow: 1 }}
                    />
                    <TextField
                        select
                        label="Durum"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        size="small"
                        sx={{ minWidth: 200 }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <FilterListIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                    >
                        <MenuItem value="all">Tümü</MenuItem>
                        <MenuItem value="active">Aktif</MenuItem>
                        <MenuItem value="inactive">Pasif</MenuItem>
                        <MenuItem value="low_battery">Düşük Pil</MenuItem>
                    </TextField>
                </Stack>
            </Paper>

            <Paper sx={{ borderRadius: 2, overflow: 'hidden', boxShadow: 2 }}>
                <Box sx={{ overflowX: 'auto' }}>
                    <Table>
                        <TableHead sx={{ bgcolor: 'background.default' }}>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Cihaz</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Sahibi</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Konum</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Durum</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', minWidth: 140 }}>Batarya</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Sinyal</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Eklendi</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>İşlemler</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredGateways.length > 0 ? (
                                filteredGateways.map((gw) => {
                                    const status = STATUS_META[gw.status] || { label: gw.status || 'Bilinmiyor', color: 'default' };
                                    const signal = SIGNAL_META[gw.signal_quality];
                                    const battery = gw.battery ?? 0;
                                    const bColor = batteryColor(gw.battery);
                                    const hasCoords = gw.location?.lat != null && gw.location?.lng != null;
                                    return (
                                        <TableRow key={gw._id} hover>
                                            <TableCell>
                                                <Stack direction="row" spacing={1.25} alignItems="center">
                                                    <Box
                                                        sx={{
                                                            width: 36,
                                                            height: 36,
                                                            borderRadius: 1.5,
                                                            bgcolor: alpha('#004CB4', 0.1),
                                                            color: 'primary.main',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }}
                                                    >
                                                        <RouterIcon fontSize="small" />
                                                    </Box>
                                                    <Box sx={{ minWidth: 0 }}>
                                                        <Typography variant="body2" fontWeight={600} noWrap>
                                                            {gw.name || '(adsız)'}
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ fontFamily: 'monospace' }}
                                                        >
                                                            {gw.serialNumber || gw._id?.slice(0, 8)}
                                                        </Typography>
                                                    </Box>
                                                </Stack>
                                            </TableCell>
                                            <TableCell>
                                                <Stack direction="row" spacing={0.5} alignItems="center">
                                                    <PersonIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                                                    <Box>
                                                        <Typography variant="body2">{formatOwner(gw.owner)}</Typography>
                                                        {gw.owner?.email && (
                                                            <Typography variant="caption" color="text.secondary">
                                                                {gw.owner.email}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                </Stack>
                                            </TableCell>
                                            <TableCell>
                                                <Stack direction="row" spacing={0.5} alignItems="center">
                                                    <LocationOnIcon
                                                        fontSize="small"
                                                        sx={{ color: hasCoords ? 'primary.main' : 'text.disabled' }}
                                                    />
                                                    <Box>
                                                        <Typography variant="body2">{formatAddress(gw.address)}</Typography>
                                                        {hasCoords && (
                                                            <Tooltip title={`${gw.location.lat}, ${gw.location.lng}`}>
                                                                <Typography
                                                                    variant="caption"
                                                                    color="text.secondary"
                                                                    sx={{ fontFamily: 'monospace' }}
                                                                >
                                                                    {gw.location.lat.toFixed(3)}, {gw.location.lng.toFixed(3)}
                                                                </Typography>
                                                            </Tooltip>
                                                        )}
                                                    </Box>
                                                </Stack>
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={status.label}
                                                    color={status.color}
                                                    size="small"
                                                    variant={status.color === 'default' ? 'outlined' : 'filled'}
                                                    sx={{ fontWeight: 600 }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Stack direction="row" alignItems="center" spacing={1}>
                                                    <Typography variant="caption" fontWeight={700} sx={{ minWidth: 36, color: bColor }}>
                                                        %{battery}
                                                    </Typography>
                                                    <Box sx={{ flex: 1, minWidth: 60 }}>
                                                        <LinearProgress
                                                            variant="determinate"
                                                            value={battery}
                                                            sx={{
                                                                height: 6,
                                                                borderRadius: 3,
                                                                bgcolor: alpha(bColor, 0.15),
                                                                '& .MuiLinearProgress-bar': { bgcolor: bColor, borderRadius: 3 },
                                                            }}
                                                        />
                                                    </Box>
                                                </Stack>
                                            </TableCell>
                                            <TableCell>
                                                {signal ? (
                                                    <Stack direction="row" spacing={0.5} alignItems="center">
                                                        <SignalCellularAltIcon fontSize="small" sx={{ color: signal.color }} />
                                                        <Typography variant="caption" sx={{ color: signal.color, fontWeight: 600 }}>
                                                            {signal.label}
                                                        </Typography>
                                                    </Stack>
                                                ) : (
                                                    <Typography variant="caption" color="text.disabled">—</Typography>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Tooltip title={gw.createdAt ? dayjs(gw.createdAt).format('DD.MM.YYYY HH:mm') : ''}>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {gw.createdAt ? dayjs(gw.createdAt).fromNow() : '—'}
                                                    </Typography>
                                                </Tooltip>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Tooltip title="Sil">
                                                    <IconButton color="error" size="small" onClick={() => handleDelete(gw._id)}>
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                                        {searchTerm || statusFilter !== 'all'
                                            ? 'Aradığınız kriterlere uygun cihaz bulunamadı.'
                                            : 'Henüz cihaz eklenmedi.'}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </Box>
            </Paper>
        </Container>
    );
};

export default GatewayManager;
