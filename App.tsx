import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
  Alert,
  Linking,
  Dimensions,
  Platform,
  Image,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';

// Try to import MapView
let MapView, Marker, Callout;
try {
  const Maps = require('react-native-maps');
  MapView = Maps.default || Maps.MapView;
  Marker = Maps.Marker;
  Callout = Maps.Callout;
} catch (error) {
  console.log('Maps not available, using fallback');
  // Fallback components
  MapView = ({ children, style, ...props }) => (
    <View style={[style, { backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }]}>
      <Text style={{ color: '#FFFFFF', fontSize: 18, marginBottom: 10 }}>🗺️ Interactive Map</Text>
      <Text style={{ color: '#94A3B8', fontSize: 14, textAlign: 'center', paddingHorizontal: 20 }}>
        Map view is not available in this environment.{'\n'}
        Use the station list below to view locations.
      </Text>
      {children}
    </View>
  );
  Marker = () => null;
  Callout = () => null;
}

// Get device dimensions
const { width, height } = Dimensions.get('window');

// FuelQ Fixed Weekly Prices
const FUELQ_WEEKLY_PRICES = {
  diesel: 130.6, // pence per litre (standard sites)
  dieselSupermarket: 133.6, // diesel + 3p surcharge for supermarkets (2.5p + VAT)
  petrolDiscount: 3, // fixed 3p/L discount off pump price (standard sites)
  petrolDiscountSupermarket: 1, // only 1p/L discount at supermarkets
  validFrom: '2024-01-22',
  validTo: '2024-01-28',
};

// Helper function to check if a brand is a supermarket
const isSupermarketBrand = (brand) => {
  const supermarkets = ['ASDA', 'TESCO', 'SAINSBURYS', 'MORRISONS', 'SAINSBURY\'S', 'MORRISON\'S'];
  return supermarkets.includes(brand?.toUpperCase());
};

// All UK fuel retailer data feed URLs
const RETAILER_FEEDS = [
  { name: 'Applegreen', url: 'https://applegreenstores.com/fuel-prices/data.json' },
  { name: 'Ascona Group', url: 'https://fuelprices.asconagroup.co.uk/newfuel.json' },
  { name: 'ASDA', url: 'https://storelocator.asda.com/fuel_prices_data.json' },
  { name: 'BP', url: 'https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json' },
  { name: 'Esso', url: 'https://fuelprices.esso.co.uk/latestdata.json' },
  { name: 'Jet', url: 'https://jetlocal.co.uk/fuel_prices_data.json' },
  { name: 'KRL', url: 'https://api2.krlmedia.com/integration/live_price/krl' },
  { name: 'Morrisons', url: 'https://www.morrisons.com/fuel-prices/fuel.json' },
  { name: 'Moto', url: 'https://moto-way.com/fuel-price/fuel_prices.json' },
  { name: 'Motor Fuel Group', url: 'https://fuel.motorfuelgroup.com/fuel_prices_data.json' },
  { name: 'Rontec', url: 'https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json' },
  { name: 'Sainsburys', url: 'https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json' },
  { name: 'SGN Retail', url: 'https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json' },
  { name: 'Shell', url: 'https://www.shell.co.uk/fuel-prices-data.html' },
  { name: 'Tesco', url: 'https://www.tesco.com/fuel_prices/fuel_prices_data.json' },
];

// Custom LinearGradient component to avoid external dependencies
const LinearGradient = ({ colors, style, children }) => {
  const backgroundColor = colors[0];
  return (
    <View style={[style, { backgroundColor }]}>
      {children}
    </View>
  );
};

// Main App Component
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userType, setUserType] = useState('guest'); // 'member' or 'guest'
  const [activeScreen, setActiveScreen] = useState('dashboard');
  const [activeTab, setActiveTab] = useState('cumulative');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  
  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  
  const [showRestrictedModal, setShowRestrictedModal] = useState(false);
  const [restrictedScreen, setRestrictedScreen] = useState('');
  
  // State for map functionality
  const [viewMode, setViewMode] = useState('map'); // Changed default to 'map'
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fuelPrices, setFuelPrices] = useState({
    petrolAverage: '1.452',
    dieselAverage: '1.534',
  });
  const [allStations, setAllStations] = useState([]);
  const [displayedStations, setDisplayedStations] = useState([]);
  const [ukFuelsSites, setUkFuelsSites] = useState([]);
  const [matchedStations, setMatchedStations] = useState([]);
  const [liveStationsCount, setLiveStationsCount] = useState(0);
  const [selectedStation, setSelectedStation] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: RETAILER_FEEDS.length });
  const [showOnlyMatched, setShowOnlyMatched] = useState(true);
  const [error, setError] = useState(null);
  // State for user location - using Slough, England as default
  const [userLocation, setUserLocation] = useState({
    latitude: 51.5105,
    longitude: -0.5950,
  });
  const [mapRegion, setMapRegion] = useState({
    latitude: 51.5105,
    longitude: -0.5950,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });
  const mapRef = useRef(null);
  
  // State for account/vehicles
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    plate: '',
    make: '',
    model: '',
    fuelType: 'diesel',
    cardNumber: '',
    isActive: true,
  });
  
  // Refs for input fields to prevent keyboard dismissal
  const plateInputRef = useRef(null);
  const makeInputRef = useRef(null);
  const modelInputRef = useRef(null);
  const cardNumberInputRef = useRef(null);
  const [vehicles, setVehicles] = useState([
    {
      id: '1',
      plate: 'AB12 XYZ',
      details: '480L last month • Premium Diesel • Efficiency: 92%',
      fuelCardLast4: '4782',
      isActive: true,
      icon: '🚗',
    },
    {
      id: '2',
      plate: 'CD71 ABQ',
      details: '213L last month • Premium Petrol • Efficiency: 88%',
      fuelCardLast4: '9156',
      isActive: true,
      icon: '🚗',
    },
    {
      id: '3',
      plate: 'LE26 WAR',
      details: '245 kWh last month • Ultra-fast charging • Efficiency: 96%',
      fuelCardLast4: '3847',
      isActive: false,
      icon: '🚙',
    },
  ]);

  const savingsData = {
    cumulative: { amount: '£1,040', label: 'Total Savings This Year', breakdown: 'Based on 8,320L annual usage', icon: '💰' },
    monthly: { amount: '£86.67', label: 'Monthly Average', breakdown: 'Average based on 693L monthly', icon: '📊' },
    fillup: { amount: '£10.00', label: 'Per Fill-up', breakdown: '80L × 12.5p saving per litre', icon: '⛽' }
  };

  // Enhanced animations on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);
  
  // Load fuel prices after login
  useEffect(() => {
    if (isLoggedIn) {
      setLoading(true);
      fetchFuelPrices().finally(() => setLoading(false));
    }
  }, [isLoggedIn]);

  const handleLogin = () => {
    setLoginError('');
    if (email.toLowerCase() === 'killian@fuelq.co.uk' && password === 'Password') {
      setIsLoggedIn(true);
      setUserType('member');
      setActiveScreen('dashboard');
      showToast('Welcome back! 🎉');
    } else {
      setLoginError('Invalid email or password');
    }
  };

  const handleGuestAccess = () => {
    setIsLoggedIn(true);
    setUserType('guest');
    setActiveScreen('map');
    showToast('Welcome! You can browse our station finder.');
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          onPress: () => {
            setIsLoggedIn(false);
            setUserType('guest');
            setEmail('');
            setPassword('');
            setActiveScreen('dashboard');
            showToast('Signed out successfully!');
          }, 
          style: 'destructive' 
        }
      ]
    );
  };

  const openRegistrationLink = async () => {
    const url = 'https://fuelq.co.uk';
    try {
      await Linking.openURL(url);
    } catch (error) {
      showToast('Unable to open registration link');
    }
  };

  const LoginScreen = () => {
    return (
      <View style={styles.loginContainer}>
        <SafeAreaView style={styles.loginSafeArea}>
          <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
          
          <ScrollView 
            style={styles.loginScrollView}
            contentContainerStyle={styles.loginScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.loginContentWrapper}>
              {/* Logo Section */}
              <View style={styles.loginLogoSection}>
                <View style={styles.loginLogoContainer}>
                  <Image 
                    source={require('./assets/fuelq-logo.png')}
                    style={styles.loginLogo}
                    resizeMode="contain"
                  />
                </View>

                <Text style={styles.loginTagline}>"Fuelling your future"</Text>
              </View>

              {/* Member Login Section */}
              <View style={styles.loginCard}>
                <View style={styles.loginCardHeader}>
                  <Text style={styles.loginCardTitle}>Member?</Text>
                  <View style={styles.memberBadge}>
                    <Text style={styles.memberBadgeText}>FULL ACCESS</Text>
                  </View>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>✉️</Text>
                  <TextInput
                    style={styles.loginInput}
                    placeholder="Email"
                    placeholderTextColor="#94A3B8"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>🔒</Text>
                  <TextInput
                    style={styles.loginInput}
                    placeholder="Password"
                    placeholderTextColor="#94A3B8"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeButton}
                  >
                    <Text style={styles.eyeIcon}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
                  </TouchableOpacity>
                </View>

                {loginError ? (
                  <Text style={styles.errorText}>{loginError}</Text>
                ) : null}

                <TouchableOpacity
                  style={styles.loginButton}
                  onPress={handleLogin}
                  activeOpacity={0.8}
                >
                  <Text style={styles.loginButtonText}>Login</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.forgotPassword}>
                  <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                </TouchableOpacity>
              </View>

              {/* Divider */}
              <View style={styles.dividerContainer}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.divider} />
              </View>

              {/* Guest Access Section */}
              <View style={styles.guestCard}>
                <View style={styles.loginCardHeader}>
                  <Text style={styles.loginCardTitle}>Guest?</Text>
                  <View style={[styles.memberBadge, styles.guestBadge]}>
                    <Text style={[styles.memberBadgeText, styles.guestBadgeText]}>LIMITED ACCESS</Text>
                  </View>
                </View>
                
                <Text style={styles.guestDescription}>
                  Browse our station finder to locate UK Fuels partners near you
                </Text>

                <TouchableOpacity
                  style={[styles.loginButton, styles.guestButton]}
                  onPress={handleGuestAccess}
                  activeOpacity={0.8}
                >
                  <Text style={styles.guestButtonIcon}>📍</Text>
                  <Text style={[styles.loginButtonText, styles.guestButtonText]}>Station Finder</Text>
                </TouchableOpacity>
              </View>

              {/* Register Link */}
              <View style={styles.registerSection}>
                <Text style={styles.registerText}>Don't have an account?</Text>
                <TouchableOpacity onPress={openRegistrationLink}>
                  <Text style={styles.registerLink}>Register at fuelq.co.uk →</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  };

  const RestrictedOverlay = ({ screen }) => (
    <TouchableOpacity 
      style={styles.restrictedOverlay} 
      activeOpacity={0.95}
      onPress={() => {
        setRestrictedScreen(screen);
        setShowRestrictedModal(true);
      }}
    >
      <View style={styles.blurContent}>
        <Text style={styles.lockIconSmall}>🔒</Text>
      </View>
    </TouchableOpacity>
  );

  const RestrictedModal = () => (
    <Modal
      visible={showRestrictedModal}
      transparent={true}
      animationType="fade"
      onRequestClose={() => setShowRestrictedModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <TouchableOpacity 
            style={styles.modalBackdrop} 
            onPress={() => setShowRestrictedModal(false)}
            activeOpacity={1}
          />
          <View style={styles.restrictedModalContent}>
            <TouchableOpacity 
              style={styles.modalCloseButton}
              onPress={() => setShowRestrictedModal(false)}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
            
            <View style={styles.restrictedModalHeader}>
              <Text style={styles.lockIcon}>🔒</Text>
              <Text style={styles.restrictedTitle}>Unlock Full Access</Text>
            </View>
            
            <Text style={styles.restrictedModalText}>
              This feature is exclusively available to FuelQ members
            </Text>
            
            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>💰</Text>
                <Text style={styles.featureText}>Track your fuel savings</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>📊</Text>
                <Text style={styles.featureText}>View transaction history</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>🎁</Text>
                <Text style={styles.featureText}>Access exclusive offers</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>🚗</Text>
                <Text style={styles.featureText}>Manage multiple vehicles</Text>
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.applyNowButton}
              onPress={() => {
                setShowRestrictedModal(false);
                openRegistrationLink();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.applyNowButtonText}>Apply Now</Text>
              <Text style={styles.applyNowSubtext}>Register at fuelq.co.uk</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.continueGuestButton}
              onPress={() => setShowRestrictedModal(false)}
            >
              <Text style={styles.continueGuestText}>Continue as Guest</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const showToast = (message) => {
    Alert.alert('FuelQ', message, [{ text: 'OK', style: 'default' }], {
      cancelable: true,
    });
  };

  const openMapNavigation = async (latitude, longitude, stationName) => {
    // Use Apple Maps URL scheme
    const url = Platform.OS === 'ios'
      ? `maps://app?daddr=${latitude},${longitude}&dirflg=d`
      : `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`;
    
    try {
      await Linking.openURL(url);
      showToast(`🗺️ Opening navigation to ${stationName}`);
    } catch (error) {
      // Fallback to web-based Apple Maps if native app is not available
      const webUrl = `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`;
      try {
        await Linking.openURL(webUrl);
      } catch (fallbackError) {
        showToast(`📍 ${stationName} • ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      }
    }
  };

  // Map functionality methods
  const normalizeString = (str) => {
    if (!str) return '';
    return str.toString()
      .toUpperCase()
      .trim()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/\s+/g, '');
  };

  const loadUKFuelsSites = async () => {
    try {
      console.log('Loading UK Fuels site list...');
      
      const UK_FUELS_WORKER_URL = 'https://uk-fuels-data.killian-16b.workers.dev/sites';
      
      const response = await fetch(UK_FUELS_WORKER_URL);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          console.log(`Loaded ${data.data.length} UK Fuels sites from API`);
          const sites = data.data.map(site => ({
            siteNo: site.siteNo,
            altSiteNo: site.altSiteNo || 0,
            latitude: parseFloat(site.lat || site.latitude) || 0,
            longitude: parseFloat(site.lng || site.longitude) || 0,
            siteName: (site.name || site.siteName || '').toUpperCase().trim(),
            street1: (site.addr || site.street1 || '').toUpperCase().trim(),
            town: (site.town || '').toUpperCase().trim(),
            postCode: (site.postcode || site.postCode || '').toUpperCase().trim(),
            brand: (site.brand || '').toUpperCase().trim(),
            hours24: site.h24 || site.hours24 || false,
            hgvAccess: site.hgv || site.hgvAccess || false,
            petrol: site.petrol || false,
            diesel: site.diesel || false,
            bands: site.bands || ''
          }));
          setUkFuelsSites(sites);
          return sites;
        }
      }
      
      console.log('Failed to load UK Fuels sites from API');
      return [];
      
    } catch (error) {
      console.error('Error loading UK Fuels sites:', error);
      return [];
    }
  };

  const matchStationsWithUKFuels = (liveStations, ukFuelsSites, averagePrices) => {
    console.log(`Matching ${liveStations.length} live stations with ${ukFuelsSites.length} UK Fuels sites...`);
    
    const matched = [];
    const unmatched = [];
    const matchedUKFuelsSiteIds = new Set();
    
    const ukFuelsPostcodeMap = {};
    const ukFuelsNameMap = {};
    const ukFuelsBrandTownMap = {};
    
    ukFuelsSites.forEach(site => {
      const normPostcode = normalizeString(site.postCode);
      const normName = normalizeString(site.siteName);
      const normBrand = normalizeString(site.brand);
      const normTown = normalizeString(site.town);
      
      if (normPostcode) {
        if (!ukFuelsPostcodeMap[normPostcode]) ukFuelsPostcodeMap[normPostcode] = [];
        ukFuelsPostcodeMap[normPostcode].push(site);
      }
      
      if (normName) {
        if (!ukFuelsNameMap[normName]) ukFuelsNameMap[normName] = [];
        ukFuelsNameMap[normName].push(site);
      }
      
      const brandTownKey = `${normBrand}_${normTown}`;
      if (normBrand && normTown) {
        if (!ukFuelsBrandTownMap[brandTownKey]) ukFuelsBrandTownMap[brandTownKey] = [];
        ukFuelsBrandTownMap[brandTownKey].push(site);
      }
    });
    
    liveStations.forEach(station => {
      let matchedSite = null;
      
      const stationPostcode = normalizeString(station.postcode);
      const stationName = normalizeString(station.name);
      const stationBrand = normalizeString(station.brand);
      const stationTown = normalizeString(station.town);
      
      if (stationPostcode && ukFuelsPostcodeMap[stationPostcode]) {
        const candidates = ukFuelsPostcodeMap[stationPostcode];
        if (candidates.length === 1) {
          matchedSite = candidates[0];
        } else {
          matchedSite = candidates.find(c => normalizeString(c.brand) === stationBrand) || candidates[0];
        }
      }
      
      if (!matchedSite && station.latitude && station.longitude) {
        let closestSite = null;
        let minDistance = 0.01;
        
        ukFuelsSites.forEach(ukSite => {
          const distance = Math.sqrt(
            Math.pow(station.latitude - ukSite.latitude, 2) + 
            Math.pow(station.longitude - ukSite.longitude, 2)
          );
          
          if (distance < minDistance) {
            const brandsMatch = normalizeString(ukSite.brand).includes(stationBrand) || 
                              stationBrand.includes(normalizeString(ukSite.brand));
            if (distance < 0.001 || brandsMatch) {
              minDistance = distance;
              closestSite = ukSite;
            }
          }
        });
        
        if (closestSite) {
          matchedSite = closestSite;
        }
      }
      
      if (!matchedSite && stationBrand && stationTown) {
        const brandTownKey = `${stationBrand}_${stationTown}`;
        if (ukFuelsBrandTownMap[brandTownKey]) {
          matchedSite = ukFuelsBrandTownMap[brandTownKey][0];
        }
      }
      
      if (matchedSite) {
        matchedUKFuelsSiteIds.add(matchedSite.siteNo);
        
        const mergedStation = {
          ...station,
          id: `matched-${matchedSite.siteNo}-${station.id}`,
          ukFuelsSiteNo: matchedSite.siteNo,
          ukFuelsAltSiteNo: matchedSite.altSiteNo,
          name: matchedSite.siteName || station.name,
          address: matchedSite.street1 || station.address,
          town: matchedSite.town || station.town,
          postcode: matchedSite.postCode || station.postcode,
          latitude: matchedSite.latitude,
          longitude: matchedSite.longitude,
          petrol_price: station.petrol_price,
          diesel_price: station.diesel_price,
          super_price: station.super_price,
          hasLivePricing: true,
          hours24: matchedSite.hours24,
          hgvAccess: matchedSite.hgvAccess,
          facilities: [
            matchedSite.hours24 && '24 Hours',
            matchedSite.hgvAccess && 'HGV Access',
          ].filter(Boolean),
          isUKFuelsSite: true,
          bands: matchedSite.bands,
        };
        matched.push(mergedStation);
      } else {
        unmatched.push(station);
      }
    });
    
    ukFuelsSites.forEach(ukSite => {
      if (!matchedUKFuelsSiteIds.has(ukSite.siteNo)) {
        const unmatchedUKSite = {
          id: `uk-fuels-only-${ukSite.siteNo}`,
          ukFuelsSiteNo: ukSite.siteNo,
          ukFuelsAltSiteNo: ukSite.altSiteNo,
          brand: ukSite.brand,
          name: ukSite.siteName,
          address: ukSite.street1,
          town: ukSite.town,
          postcode: ukSite.postCode,
          latitude: ukSite.latitude,
          longitude: ukSite.longitude,
          petrol_price: averagePrices?.petrol || null,
          diesel_price: averagePrices?.diesel || null,
          super_price: null,
          hasLivePricing: false,
          hours24: ukSite.hours24,
          hgvAccess: ukSite.hgvAccess,
          facilities: [
            ukSite.hours24 && '24 Hours',
            ukSite.hgvAccess && 'HGV Access',
          ].filter(Boolean),
          isUKFuelsSite: true,
          bands: ukSite.bands,
          last_updated: new Date().toISOString(),
        };
        
        if (ukSite.petrol || ukSite.diesel) {
          matched.push(unmatchedUKSite);
        }
      }
    });
    
    console.log(`Matched ${matched.length} stations (${matchedUKFuelsSiteIds.size} with live prices)`);
    
    const liveCount = matched.filter(s => s.hasLivePricing === true).length;
    
    return { matched, unmatched, liveCount };
  };

  const parseStationData = (data, retailerName) => {
    const stations = [];
    
    try {
      let stationArray = [];
      
      if (data.stations) {
        stationArray = data.stations;
      } else if (data.data) {
        stationArray = data.data;
      } else if (data.results) {
        stationArray = data.results;
      } else if (data.fuel_prices) {
        stationArray = data.fuel_prices;
      } else if (data.items) {
        stationArray = data.items;
      } else if (data.sites) {
        stationArray = data.sites;
      } else if (data.locations) {
        stationArray = data.locations;
      } else if (data.stores) {
        stationArray = data.stores;
      } else if (data.forecourts) {
        stationArray = data.forecourts;
      } else if (Array.isArray(data)) {
        stationArray = data;
      } else {
        for (const key in data) {
          if (Array.isArray(data[key]) && data[key].length > 0) {
            stationArray = data[key];
            break;
          }
        }
      }
      
      stationArray.forEach((station, index) => {
        try {
          let latitude = 0;
          let longitude = 0;
          
          if (station.location && typeof station.location === 'object') {
            latitude = parseFloat(station.location.latitude || station.location.lat || 0);
            longitude = parseFloat(station.location.longitude || station.location.lng || station.location.lon || 0);
          } else if (station.latitude && station.longitude) {
            latitude = parseFloat(station.latitude);
            longitude = parseFloat(station.longitude);
          } else if (station.lat && (station.lng || station.lon || station.long)) {
            latitude = parseFloat(station.lat);
            longitude = parseFloat(station.lng || station.lon || station.long);
          } else if (station.geo) {
            latitude = parseFloat(station.geo.lat || 0);
            longitude = parseFloat(station.geo.lng || station.geo.lon || 0);
          } else if (station.coords) {
            latitude = parseFloat(station.coords.latitude || station.coords.lat || 0);
            longitude = parseFloat(station.coords.longitude || station.coords.lng || 0);
          }
          
          latitude = isNaN(latitude) ? 0 : latitude;
          longitude = isNaN(longitude) ? 0 : longitude;
          
          const parsedStation = {
            id: `${retailerName}-${station.id || station.site_id || station.store_id || station.location_id || station.number || index}`,
            brand: station.brand || station.brand_name || retailerName,
            name: station.name || station.site_name || station.store_name || station.trading_name || station.location_name || `${retailerName} Station`,
            address: station.address || station.street || station.street_address || station.address_line_1 || '',
            postcode: station.postcode || station.post_code || station.postal_code || station.zip || '',
            town: station.town || station.city || station.locality || '',
            latitude: latitude,
            longitude: longitude,
            petrol_price: null,
            diesel_price: null,
            super_price: null,
            last_updated: station.last_updated || station.updated_at || new Date().toISOString(),
            is_open: station.is_open !== false && station.status !== 'closed',
            facilities: station.facilities || station.amenities || station.services || [],
          };
          
          if (station.prices) {
            if (typeof station.prices.E10 === 'number') {
              parsedStation.petrol_price = station.prices.E10 / 100;
            }
            if (typeof station.prices.E5 === 'number') {
              parsedStation.super_price = station.prices.E5 / 100;
            }
            if (typeof station.prices.B7 === 'number') {
              parsedStation.diesel_price = station.prices.B7 / 100;
            }
            if (typeof station.prices.SDV === 'number' && !parsedStation.diesel_price) {
              parsedStation.diesel_price = station.prices.SDV / 100;
            }
            if (station.prices.unleaded) {
              parsedStation.petrol_price = parseFloat(station.prices.unleaded);
            }
            if (station.prices.diesel) {
              parsedStation.diesel_price = parseFloat(station.prices.diesel);
            }
            if (station.prices.super_unleaded) {
              parsedStation.super_price = parseFloat(station.prices.super_unleaded);
            }
          }
          
          if (station.fuel_type_services) {
            station.fuel_type_services.forEach(fuel => {
              if (fuel.fuel_type === 'ULDS' || fuel.fuel_type === 'Unleaded') {
                parsedStation.petrol_price = parseFloat(fuel.price) / 100;
              } else if (fuel.fuel_type === 'ULSD' || fuel.fuel_type === 'Diesel') {
                parsedStation.diesel_price = parseFloat(fuel.price) / 100;
              } else if (fuel.fuel_type === 'SUL' || fuel.fuel_type === 'Super Unleaded') {
                parsedStation.super_price = parseFloat(fuel.price) / 100;
              }
            });
          }
          
          if (station.fuelPrices) {
            if (station.fuelPrices.E10) parsedStation.petrol_price = parseFloat(station.fuelPrices.E10) / 100;
            if (station.fuelPrices.B7) parsedStation.diesel_price = parseFloat(station.fuelPrices.B7) / 100;
            if (station.fuelPrices.E5) parsedStation.super_price = parseFloat(station.fuelPrices.E5) / 100;
          }
          
          if (!parsedStation.petrol_price && !parsedStation.diesel_price) {
            if (station.unleaded) parsedStation.petrol_price = parseFloat(station.unleaded) / 100;
            if (station.diesel) parsedStation.diesel_price = parseFloat(station.diesel) / 100;
            if (station.super_unleaded) parsedStation.super_price = parseFloat(station.super_unleaded) / 100;
            
            if (station.unleaded_price) parsedStation.petrol_price = parseFloat(station.unleaded_price);
            if (station.diesel_price) parsedStation.diesel_price = parseFloat(station.diesel_price);
            if (station.super_unleaded_price) parsedStation.super_price = parseFloat(station.super_unleaded_price);
            
            if (station.petrol) parsedStation.petrol_price = parseFloat(station.petrol);
            if (station.petrol_price) parsedStation.petrol_price = parseFloat(station.petrol_price);
            if (station.fuel_prices?.unleaded) parsedStation.petrol_price = parseFloat(station.fuel_prices.unleaded);
            if (station.fuel_prices?.diesel) parsedStation.diesel_price = parseFloat(station.fuel_prices.diesel);
          }
          
          if (typeof parsedStation.petrol_price === 'string') {
            parsedStation.petrol_price = parseFloat(parsedStation.petrol_price) || null;
          }
          if (typeof parsedStation.diesel_price === 'string') {
            parsedStation.diesel_price = parseFloat(parsedStation.diesel_price) || null;
          }
          if (typeof parsedStation.super_price === 'string') {
            parsedStation.super_price = parseFloat(parsedStation.super_price) || null;
          }
          
          if (parsedStation.petrol_price || parsedStation.diesel_price || parsedStation.super_price) {
            stations.push(parsedStation);
          }
        } catch (stationError) {
          console.error(`Error parsing station ${index} from ${retailerName}:`, stationError);
        }
      });
      
    } catch (error) {
      console.error(`Error parsing data from ${retailerName}:`, error);
    }
    
    return stations;
  };

  const generateDemoStations = () => {
    const stations = [];
    const retailers = ['ASDA', 'Tesco', 'Sainsburys', 'Morrisons', 'Shell', 'BP', 'Esso'];
    const basePrice = 1.452;
    
    for (let i = 0; i < 20; i++) {
      const retailer = retailers[Math.floor(Math.random() * retailers.length)];
      const priceOffset = (Math.random() - 0.5) * 0.1;
      
      stations.push({
        id: `demo-${i}`,
        brand: retailer,
        name: `${retailer} ${['Station', 'Express', 'Fuel', 'Petrol'][Math.floor(Math.random() * 4)]}`,
        address: `${Math.floor(Math.random() * 999) + 1} ${['High Street', 'Main Road', 'London Road'][Math.floor(Math.random() * 3)]}`,
        postcode: `SW${Math.floor(Math.random() * 20) + 1} ${Math.floor(Math.random() * 9)}AB`,
        town: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow'][Math.floor(Math.random() * 5)],
        latitude: 51.5074 + (Math.random() - 0.5) * 0.5,
        longitude: -0.1278 + (Math.random() - 0.5) * 0.5,
        petrol_price: (basePrice + priceOffset).toFixed(3),
        diesel_price: (basePrice + 0.08 + priceOffset).toFixed(3),
        super_price: (basePrice + 0.13 + priceOffset).toFixed(3),
        last_updated: new Date().toISOString(),
        is_open: true,
        isUKFuelsSite: true,
        hasLivePricing: true,
        facilities: ['24 Hours', 'Car Wash', 'Shop'],
      });
    }
    
    return stations;
  };

  const fetchFuelPrices = async () => {
    try {
      setError(null);
      setLoadingProgress({ current: 0, total: RETAILER_FEEDS.length + 1 });
      console.log('Loading UK fuel prices from all retailers...');
      
      let ukSites = ukFuelsSites;
      if (ukSites.length === 0) {
        ukSites = await loadUKFuelsSites();
      }
      
      const allFetchedStations = [];
      let successfulFeeds = 0;
      
      const WORKER_URL = 'https://fuelprices-fuelq.killian-16b.workers.dev';
      
      try {
        console.log('Fetching from Cloudflare Worker proxy...');
        const response = await fetch(`${WORKER_URL}/api/all`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const allData = await response.json();
        
        Object.entries(allData).forEach(([retailerName, result], index) => {
          if (retailerName === '_summary') return;
          
          setLoadingProgress(prev => ({ ...prev, current: index + 1 }));
          
          if (result.success && result.data) {
            const stations = parseStationData(result.data, retailerName);
            console.log(`Processed ${stations.length} stations from ${retailerName}`);
            allFetchedStations.push(...stations);
            successfulFeeds++;
          }
        });
        
      } catch (error) {
        console.error('Failed to fetch from Cloudflare Worker:', error);
        const demoStations = generateDemoStations();
        allFetchedStations.push(...demoStations);
      }
      
      const petrolPrices = allFetchedStations
        .filter(s => s.petrol_price)
        .map(s => parseFloat(s.petrol_price));
      const dieselPrices = allFetchedStations
        .filter(s => s.diesel_price)
        .map(s => parseFloat(s.diesel_price));
      
      const { matched, unmatched, liveCount } = matchStationsWithUKFuels(allFetchedStations, ukSites, {
        petrol: petrolPrices.length > 0 
          ? (petrolPrices.reduce((a, b) => a + b, 0) / petrolPrices.length).toFixed(3)
          : '1.452',
        diesel: dieselPrices.length > 0
          ? (dieselPrices.reduce((a, b) => a + b, 0) / dieselPrices.length).toFixed(3)
          : '1.534'
      });
      setMatchedStations(matched);
      setLiveStationsCount(liveCount);
      
      console.log(`Successfully fetched from ${successfulFeeds}/${RETAILER_FEEDS.length} feeds`);
      console.log(`Total stations loaded: ${allFetchedStations.length}`);
      console.log(`Matched with UK Fuels: ${matched.length}`);
      
      const stationsForAverage = showOnlyMatched ? matched : allFetchedStations;
      const avgPetrolPrices = stationsForAverage
        .filter(s => s.petrol_price)
        .map(s => parseFloat(s.petrol_price));
      const avgDieselPrices = stationsForAverage
        .filter(s => s.diesel_price)
        .map(s => parseFloat(s.diesel_price));
      
      const processedData = {
        stations: allFetchedStations,
        matchedStations: matched,
        totalStations: allFetchedStations.length,
        matchedCount: matched.length,
        ukFuelsCount: ukSites.length,
        successfulFeeds: successfulFeeds,
        petrolAverage: avgPetrolPrices.length > 0 
          ? (avgPetrolPrices.reduce((a, b) => a + b, 0) / avgPetrolPrices.length).toFixed(3)
          : '1.452',
        dieselAverage: avgDieselPrices.length > 0
          ? (avgDieselPrices.reduce((a, b) => a + b, 0) / avgDieselPrices.length).toFixed(3)
          : '1.534',
        lastUpdated: new Date().toISOString(),
        dataSource: successfulFeeds > 0 ? 'Live retailer data' : 'Demo data',
      };
      
      setFuelPrices(processedData);
      setAllStations(allFetchedStations);
      
      if (showOnlyMatched) {
        setDisplayedStations(matched);
      } else {
        setDisplayedStations(allFetchedStations);
      }
      
    } catch (err) {
      console.error('Error loading fuel prices:', err);
      setError(err.message);
      
      const demoStations = generateDemoStations();
      setAllStations(demoStations);
      setDisplayedStations(demoStations);
    }
  };

  useEffect(() => {
    if (activeScreen === 'map' || activeScreen === 'dashboard') {
      setLoading(true);
      fetchFuelPrices().finally(() => setLoading(false));
    }
  }, [activeScreen]);

  useEffect(() => {
    const stationsToFilter = showOnlyMatched ? matchedStations : allStations;
    
    if (stationsToFilter && stationsToFilter.length > 0) {
      let filtered = stationsToFilter;
      
      if (searchQuery !== '') {
        const query = searchQuery.toLowerCase();
        filtered = stationsToFilter.filter(station => 
          station.name?.toLowerCase().includes(query) ||
          station.brand?.toLowerCase().includes(query) ||
          station.address?.toLowerCase().includes(query) ||
          station.postcode?.toLowerCase().includes(query) ||
          station.town?.toLowerCase().includes(query) ||
          (station.ukFuelsSiteNo && station.ukFuelsSiteNo.toString().includes(query))
        );
      }
      
      // Sort by distance
      const sortedStations = sortStationsByDistance(filtered);
      setDisplayedStations(sortedStations);
    } else {
      setDisplayedStations([]);
    }
  }, [searchQuery, allStations, matchedStations, showOnlyMatched, userLocation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFuelPrices();
    setRefreshing(false);
  };

  // Calculate distance between two coordinates (in km)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const d = R * c; // Distance in km
    return d;
  };

  // Convert km to miles
  const kmToMiles = (km) => {
    return (km * 0.621371).toFixed(1);
  };

  // Sort stations by distance
  const sortStationsByDistance = (stations) => {
    return stations.map(station => ({
      ...station,
      distance: calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        station.latitude,
        station.longitude
      )
    })).sort((a, b) => a.distance - b.distance);
  };

  const focusOnStation = (station) => {
    if (station.latitude && station.longitude) {
      setViewMode('map');
      
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: station.latitude,
            longitude: station.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }, 1000);
        }
      }, 100);
    }
    setSelectedStation(station);
  };

  // Auto-select nearest station on map view
  useEffect(() => {
    if (viewMode === 'map' && displayedStations.length > 0 && !selectedStation) {
      // Sort stations by distance and select the nearest one
      const sortedStations = sortStationsByDistance(displayedStations.filter(s => s.latitude && s.longitude));
      if (sortedStations.length > 0) {
        setSelectedStation(sortedStations[0]);
      }
    }
  }, [viewMode, displayedStations]);

  const Logo = () => (
    <Animated.View style={[
      styles.logoContainer,
      {
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }]
      }
    ]}>
      <Text style={styles.logoTagline}>Fuelling your future</Text>
    </Animated.View>
  );

  const SavingsCard = () => {
    return (
      <Animated.View style={[
        styles.savingsCardWrapper,
        { transform: [{ scale: scaleAnim }] }
      ]}>
        <LinearGradient
          colors={['#1E293B', '#334155', '#475569']}
          style={styles.savingsCard}
        >
          <View style={styles.savingsHeader}>
            <Text style={styles.savingsTitle}>Your Savings</Text>
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsBadgeText}>PREMIUM</Text>
            </View>
          </View>

          <View style={styles.savingsTabs}>
            {Object.keys(savingsData).map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.savingsTab, activeTab === key && styles.savingsTabActive]}
                onPress={() => setActiveTab(key)}
                activeOpacity={0.7}
              >
                <Text style={styles.savingsTabIcon}>{savingsData[key].icon}</Text>
                <Text style={[styles.savingsTabText, activeTab === key && styles.savingsTabTextActive]}>
                  {key === 'cumulative' ? 'Total' : key === 'monthly' ? 'Monthly' : 'Per Fill'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          
          <View style={styles.savingsContent}>
            <Text style={styles.savingsAmount}>
              {savingsData[activeTab].amount}
            </Text>
            <Text style={styles.savingsLabel}>{savingsData[activeTab].label}</Text>
            <Text style={styles.savingsBreakdown}>{savingsData[activeTab].breakdown}</Text>
          </View>

          <LinearGradient
            colors={['#10B981', '#059669']}
            style={styles.cashBackBanner}
          >
            <View style={styles.cashBackContent}>
              <View>
                <Text style={styles.cashBackTitle}>1% Cash Back Earned</Text>
                <Text style={styles.cashBackAmount}>£109.82</Text>
              </View>
              <TouchableOpacity style={styles.redeemButton} onPress={() => showToast('💳 Redeem options coming soon!')}>
                <Text style={styles.redeemButtonText}>🔓 Redeem</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </LinearGradient>
      </Animated.View>
    );
  };

  const StationCard = ({ station, onPress }) => {
    const isSupermarket = isSupermarketBrand(station.brand);
    const pumpPetrolPPL = station.petrol_price ? parseFloat(station.petrol_price) * 100 : null;
    const pumpDieselPPL = station.diesel_price ? parseFloat(station.diesel_price) * 100 : null;
    
    // Apply correct pricing based on whether it's a supermarket
    const dieselFuelQPrice = isSupermarket ? FUELQ_WEEKLY_PRICES.dieselSupermarket : FUELQ_WEEKLY_PRICES.diesel;
    const petrolDiscount = isSupermarket ? FUELQ_WEEKLY_PRICES.petrolDiscountSupermarket : FUELQ_WEEKLY_PRICES.petrolDiscount;
    const fuelqPetrolPPL = pumpPetrolPPL ? pumpPetrolPPL - petrolDiscount : null;
    
    const hasPetrol = station.petrol !== false;
    const hasDiesel = station.diesel !== false;

    return (
      <TouchableOpacity
        style={[styles.stationCard, station.premium && styles.stationCardPremium]}
        onPress={onPress}
        activeOpacity={0.9}
      >
        <View style={styles.stationHeader}>
          <View style={styles.stationInfo}>
            <Text style={styles.stationName}>{station.name}</Text>
            <View style={styles.stationMeta}>
              <View style={[styles.statusBadge, { backgroundColor: '#22C55E' }]}>
                <Text style={styles.statusText}>Available</Text>
              </View>
              <Text style={styles.stationDistance}>📍 {station.distance ? `${station.distance}` : '0.8 miles'}</Text>
              {station.ukFuelsSiteNo && (
                <Text style={styles.siteNumberText}>Site #{station.ukFuelsSiteNo}</Text>
              )}
            </View>
          </View>
          
          <View style={styles.stationPricing}>
            {hasDiesel && (
              <View style={styles.fuelPriceColumn}>
                <Text style={styles.fuelTypeLabel}>Diesel</Text>
                <Text style={styles.currentPrice}>{dieselFuelQPrice.toFixed(1)}p/L</Text>
                {pumpDieselPPL && (
                  <Text style={styles.pumpPrice}>Pump: {pumpDieselPPL.toFixed(1)}p</Text>
                )}
                <View style={styles.savingBadge}>
                  <Text style={styles.savingText}>{isSupermarket ? '+3p charge' : 'Fixed Price'}</Text>
                </View>
              </View>
            )}
            {hasDiesel && hasPetrol && <View style={styles.priceDivider} />}
            {hasPetrol && (
              <View style={styles.fuelPriceColumn}>
                <Text style={styles.fuelTypeLabel}>Petrol</Text>
                <Text style={styles.currentPrice}>{petrolDiscount}p/L</Text>
                {pumpPetrolPPL && (
                  <Text style={styles.pumpPrice}>Pump: {pumpPetrolPPL.toFixed(1)}p</Text>
                )}
                <View style={styles.savingBadge}>
                  <Text style={styles.savingText}>Savings</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.stationAmenities}>
          {station.brand && (
            <Text style={styles.brandBadgeText}>{station.brand}</Text>
          )}
          {(station.facilities || ['Premium Shop', 'Car Wash']).slice(0, 2).map((amenity, idx) => (
            <View key={idx} style={styles.amenityChip}>
              <Text style={styles.amenityText}>{amenity}</Text>
            </View>
          ))}
          {station.isUKFuelsSite && (
            <View style={[styles.amenityChip, styles.ukFuelsChip]}>
              <Text style={[styles.amenityText, styles.ukFuelsChipText]}>UK Fuels</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.navigateButton}
          onPress={(e) => {
            e.stopPropagation();
            openMapNavigation(station.latitude, station.longitude, station.name);
          }}
        >
          <Text style={styles.navigateButtonText}>Navigate →</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const DashboardScreen = () => (
    <Animated.ScrollView 
      style={styles.screen}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      <Logo />
      
      <View style={styles.welcomeSection}>
        <View style={styles.welcomeContent}>
          <Text style={styles.welcomeText}>Where are we driving today</Text>
          <Text style={styles.userName}>James</Text>
        </View>
        <TouchableOpacity style={styles.profileButton} onPress={() => setActiveScreen('account')}>
          <LinearGradient
            colors={['#E11D48', '#BE123C']}
            style={styles.profileGradient}
          >
            <Text style={styles.profileInitial}>J</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <SavingsCard />

      {/* Quick Stats */}
      <View style={styles.quickStats}>
        <TouchableOpacity 
          style={styles.statItem}
          onPress={() => showToast('📊 Fuel consumption details coming soon!')}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#3B82F6', '#2563EB']}
            style={styles.statGradient}
          >
            <Text style={styles.statIcon}>⛽</Text>
            <Text style={styles.statValue}>693L</Text>
            <Text style={styles.statLabel}>This Month</Text>
            <Text style={styles.statTapHint}>Tap for details</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.statItem}
          onPress={() => showToast('💰 Savings breakdown coming soon!')}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#8B5CF6', '#7C3AED']}
            style={styles.statGradient}
          >
            <Text style={styles.statIcon}>💷</Text>
            <Text style={styles.statValue}>£86.67</Text>
            <Text style={styles.statLabel}>Saved Monthly</Text>
            <Text style={styles.statTapHint}>Tap for details</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.statItem}
          onPress={() => showToast('🌱 Emissions report coming soon!')}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#10B981', '#059669']}
            style={styles.statGradient}
          >
            <Text style={styles.statIcon}>🌱</Text>
            <Text style={styles.statValue}>-15%</Text>
            <Text style={styles.statLabel}>CO₂ Reduced</Text>
            <Text style={styles.statTapHint}>Tap for details</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Weekly Trends */}
      <TouchableOpacity 
        style={styles.trendCard} 
        onPress={() => showToast('📈 Price trends analysis coming soon!')}
        activeOpacity={0.9}
      >
        <View style={styles.trendHeader}>
          <Text style={styles.trendTitle}>April Price Trends</Text>
          <Text style={styles.trendViewMore}>Tap for details →</Text>
        </View>
        
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.trendScroll}>
          {[
            { week: 'W1', price: '1.35', change: -3, trend: 'down' },
            { week: 'W2', price: '1.32', change: -3, trend: 'down' },
            { week: 'W3', price: '1.34', change: 2, trend: 'up' },
            { week: 'W4', price: '1.31', change: -3, trend: 'down' },
            { week: 'Now', price: '1.32', change: 1, trend: 'up', current: true },
          ].map((item, index) => (
            <View key={index} style={[styles.trendItem, item.current && styles.trendItemCurrent]}>
              <Text style={[styles.trendWeek, item.current && styles.trendWeekCurrent]}>{item.week}</Text>
              <Text style={[styles.trendPrice, item.current && styles.trendPriceCurrent]}>£{item.price}</Text>
              <View style={[
                styles.trendChange,
                item.trend === 'up' ? styles.trendChangeUp : styles.trendChangeDown
              ]}>
                <Text style={styles.trendChangeText}>
                  {item.trend === 'up' ? '↑' : '↓'} {Math.abs(item.change)}p
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Nearby Stations</Text>
        <TouchableOpacity onPress={() => setActiveScreen('map')}>
          <Text style={styles.seeAllButton}>See All →</Text>
        </TouchableOpacity>
      </View>

      {displayedStations.length > 0 ? (
        displayedStations.slice(0, 3).map((station) => (
          <StationCard
            key={station.id}
            station={{
              ...station,
              distance: station.distance ? kmToMiles(station.distance) + ' miles' : undefined,
              diesel: station.diesel !== false,
              petrol: station.petrol !== false,
            }}
            onPress={() => setActiveScreen('map')}
          />
        ))
      ) : (
        <View style={styles.noStationsMessage}>
          <Text style={styles.noStationsText}>Loading nearby stations...</Text>
          <ActivityIndicator size="small" color="#3B82F6" style={{ marginTop: 10 }} />
        </View>
      )}

      {/* Premium Banner */}
      <TouchableOpacity style={styles.premiumBanner} onPress={() => showToast('🌟 Premium features showcase coming soon!')}>
        <LinearGradient
          colors={['#7C3AED', '#6D28D9', '#5B21B6']}
          style={styles.premiumBannerGradient}
        >
          <View style={styles.premiumBannerContent}>
            <Text style={styles.premiumBannerTitle}>Unlock Premium Benefits</Text>
            <Text style={styles.premiumBannerSubtitle}>Get exclusive discounts and rewards</Text>
          </View>
          <Text style={styles.premiumBannerArrow}>→</Text>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.ScrollView>
  );

  const MapScreen = () => {
    const renderStationItem = ({ item }) => {
      if (!item.isUKFuelsSite) {
        return null;
      }
      
      const isSupermarket = isSupermarketBrand(item.brand);
      const pumpPetrolPPL = item.petrol_price ? parseFloat(item.petrol_price) * 100 : null;
      const pumpDieselPPL = item.diesel_price ? parseFloat(item.diesel_price) * 100 : null;
      
      // Apply correct pricing based on whether it's a supermarket
      const dieselFuelQPrice = isSupermarket ? FUELQ_WEEKLY_PRICES.dieselSupermarket : FUELQ_WEEKLY_PRICES.diesel;
      const petrolDiscount = isSupermarket ? FUELQ_WEEKLY_PRICES.petrolDiscountSupermarket : FUELQ_WEEKLY_PRICES.petrolDiscount;
      const fuelqPetrolPPL = pumpPetrolPPL ? pumpPetrolPPL - petrolDiscount : null;
      const dieselSavingPPL = pumpDieselPPL ? pumpDieselPPL - dieselFuelQPrice : null;
      
      const hasPetrol = item.petrol !== false;
      const hasDiesel = item.diesel !== false;
      
      return (
        <TouchableOpacity
          style={[
            styles.stationCard,
            styles.stationCardPremium
          ]}
          onPress={() => focusOnStation(item)}
        >
          <View style={styles.stationHeader}>
            <View style={styles.stationInfo}>
              <Text style={styles.stationName}>{item.name}</Text>
              <View style={styles.stationMeta}>
                <View style={[styles.statusBadge, { backgroundColor: '#22C55E' }]}>
                  <Text style={styles.statusText}>Available</Text>
                </View>
                {item.postcode && (
                  <Text style={styles.stationDistance}>📍 {item.postcode} • {kmToMiles(item.distance || 0)} miles</Text>
                )}
                {item.ukFuelsSiteNo && (
                  <Text style={styles.siteNumberText}>Site #{item.ukFuelsSiteNo}</Text>
                )}
              </View>
            </View>
            
            <View style={styles.stationPricing}>
              {hasDiesel && (
                <View style={styles.fuelPriceColumn}>
                  <Text style={styles.fuelTypeLabel}>Diesel</Text>
                  <Text style={styles.currentPrice}>{dieselFuelQPrice.toFixed(1)}p/L</Text>
                  {pumpDieselPPL && (
                    <Text style={styles.pumpPrice}>Pump: {pumpDieselPPL.toFixed(1)}p</Text>
                  )}
                  <View style={styles.savingBadge}>
                    <Text style={styles.savingText}>{isSupermarket ? '+3p charge' : 'Fixed Price'}</Text>
                  </View>
                </View>
              )}
              {hasDiesel && hasPetrol && <View style={styles.priceDivider} />}
              {hasPetrol && (
                <View style={styles.fuelPriceColumn}>
                  <Text style={styles.fuelTypeLabel}>Petrol</Text>
                  <Text style={styles.currentPrice}>{petrolDiscount}p/L</Text>
                  {pumpPetrolPPL && (
                    <Text style={styles.pumpPrice}>Pump: {pumpPetrolPPL.toFixed(1)}p</Text>
                  )}
                  <View style={styles.savingBadge}>
                    <Text style={styles.savingText}>Savings</Text>
                  </View>
                </View>
              )}
              {!hasPetrol && !hasDiesel && (
                <Text style={styles.noPriceText}>No fuel data</Text>
              )}
            </View>
          </View>

          <View style={styles.stationAmenities}>
            <Text style={styles.brandBadgeText}>{item.brand}</Text>
            {item.bands && (
              <View style={[styles.amenityChip, styles.bandChip]}>
                <Text style={styles.amenityText}>Band {item.bands}</Text>
              </View>
            )}
            {item.facilities && item.facilities.map((amenity, idx) => (
              <View key={idx} style={styles.amenityChip}>
                <Text style={styles.amenityText}>{amenity}</Text>
              </View>
            ))}
            <View style={[styles.amenityChip, styles.ukFuelsChip]}>
              <Text style={[styles.amenityText, styles.ukFuelsChipText]}>UK Fuels</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.navigateButton}
            onPress={(e) => {
              e.stopPropagation();
              openMapNavigation(item.latitude, item.longitude, item.name);
            }}
          >
            <Text style={styles.navigateButtonText}>Navigate →</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      );
    };

    const renderMapView = () => {
      const nearbyStations = displayedStations
        .filter(s => s.latitude && s.longitude)
        .slice(0, 50);

      return (
        <View style={styles.mapWrapper}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={null} // Use default provider (Apple Maps on iOS)
            initialRegion={mapRegion}
            showsUserLocation={true}
            showsMyLocationButton={true}
            customMapStyle={undefined} // Apple Maps doesn't support custom styles like Google Maps
          >
            {Marker && nearbyStations.map((station) => (
              <Marker
                key={station.id}
                coordinate={{
                  latitude: station.latitude,
                  longitude: station.longitude,
                }}
                onPress={() => setSelectedStation(station)}
              >
                <View style={[
                  styles.mapMarker,
                  station.isUKFuelsSite && styles.mapMarkerUKFuels,
                  selectedStation?.id === station.id && styles.mapMarkerSelected
                ]}>
                  <Text style={styles.mapMarkerText}>⛽</Text>
                </View>
                {Callout && (
                  <Callout onPress={() => openMapNavigation(station.latitude, station.longitude, station.name)}>
                    <View style={styles.calloutContainer}>
                      <Text style={styles.calloutTitle}>{station.name}</Text>
                      {station.isUKFuelsSite && (
                        <View style={styles.calloutUKFuelsBadge}>
                          <Text style={styles.calloutUKFuelsText}>UK Fuels Partner</Text>
                        </View>
                      )}
                      {station.isUKFuelsSite && station.petrol ? (
                        <>
                          <Text style={styles.calloutFuelQPrice}>
                            FuelQ: {station.petrol_price ? 
                              `${((parseFloat(station.petrol_price) * 100) - (isSupermarketBrand(station.brand) ? FUELQ_WEEKLY_PRICES.petrolDiscountSupermarket : FUELQ_WEEKLY_PRICES.petrolDiscount)).toFixed(1)}p` : 
                              `${isSupermarketBrand(station.brand) ? '1p' : '3p'} off pump`}
                          </Text>
                          {station.petrol_price && station.hasLivePricing !== false && (
                            <>
                              <Text style={styles.calloutPumpPrice}>
                                Pump: {(parseFloat(station.petrol_price) * 100).toFixed(1)}p
                              </Text>
                              <Text style={styles.calloutSaving}>
                                Save {isSupermarketBrand(station.brand) ? FUELQ_WEEKLY_PRICES.petrolDiscountSupermarket : FUELQ_WEEKLY_PRICES.petrolDiscount}p/L
                              </Text>
                            </>
                          )}
                        </>
                      ) : (
                        <Text style={styles.calloutPrice}>
                          {station.petrol_price ? (parseFloat(station.petrol_price) * 100).toFixed(1) + 'p' : 'No price'}
                          {station.hasLivePricing === false && ' (UK Avg)'}
                        </Text>
                      )}
                      <Text style={styles.calloutAddress}>{station.address}</Text>
                      {station.ukFuelsSiteNo && (
                        <Text style={styles.calloutSiteNo}>Site #{station.ukFuelsSiteNo}</Text>
                      )}
                      <View style={styles.calloutButton}>
                        <Text style={styles.calloutButtonText}>Navigate →</Text>
                      </View>
                    </View>
                  </Callout>
                )}
              </Marker>
            ))}
          </MapView>

          <View style={styles.mapInfoOverlay}>
            <Text style={styles.mapInfoText}>
              Showing {nearbyStations.length} of {displayedStations.length} stations
            </Text>
            {liveStationsCount > 0 && (
              <Text style={styles.mapInfoSubtext}>
                {liveStationsCount} with live pricing
              </Text>
            )}
          </View>

          {/* Selected Station Info Bar */}
          {selectedStation && (
            <ScrollView 
              style={styles.selectedStationBar}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.selectedStationContent}>
                <View style={styles.selectedStationHeader}>
                  <View style={styles.selectedStationInfo}>
                    <Text style={styles.selectedStationName}>{selectedStation.name}</Text>
                    <Text style={styles.selectedStationAddress}>
                      {selectedStation.address || selectedStation.postcode}
                      {selectedStation.distance && ` • ${kmToMiles(selectedStation.distance)} miles`}
                    </Text>
                    {selectedStation.ukFuelsSiteNo && (
                      <Text style={styles.selectedStationSiteNo}>Site #{selectedStation.ukFuelsSiteNo}</Text>
                    )}
                  </View>
                  <TouchableOpacity 
                    style={styles.closeButton}
                    onPress={() => setSelectedStation(null)}
                  >
                    <Text style={styles.closeButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.selectedStationPricing}>
                  {selectedStation.diesel !== false && (
                    <View style={styles.selectedFuelPrice}>
                      <Text style={styles.selectedFuelType}>Diesel</Text>
                      <Text style={styles.selectedPrice}>
                        {isSupermarketBrand(selectedStation.brand) ? 
                          FUELQ_WEEKLY_PRICES.dieselSupermarket.toFixed(1) : 
                          FUELQ_WEEKLY_PRICES.diesel.toFixed(1)}p/L
                      </Text>
                      {selectedStation.diesel_price && (
                        <Text style={styles.selectedPumpPrice}>
                          Pump: {(parseFloat(selectedStation.diesel_price) * 100).toFixed(1)}p
                        </Text>
                      )}
                      <Text style={styles.selectedSaving}>
                        {isSupermarketBrand(selectedStation.brand) ? '+3p charge' : 'Fixed Price'}
                      </Text>
                    </View>
                  )}
                  {selectedStation.diesel !== false && selectedStation.petrol !== false && (
                    <View style={styles.selectedPriceDivider} />
                  )}
                  {selectedStation.petrol !== false && (
                    <View style={styles.selectedFuelPrice}>
                      <Text style={styles.selectedFuelType}>Petrol</Text>
                      <Text style={styles.selectedPrice}>
                        {isSupermarketBrand(selectedStation.brand) ? '1p/L' : '3p/L'}
                      </Text>
                      {selectedStation.petrol_price && (
                        <Text style={styles.selectedPumpPrice}>
                          Pump: {(parseFloat(selectedStation.petrol_price) * 100).toFixed(1)}p
                        </Text>
                      )}
                      <Text style={styles.selectedSaving}>Savings</Text>
                    </View>
                  )}
                </View>
                
                <TouchableOpacity
                  style={styles.selectedNavigateButton}
                  onPress={() => openMapNavigation(selectedStation.latitude, selectedStation.longitude, selectedStation.name)}
                >
                  <Text style={styles.selectedNavigateText}>Navigate to Station →</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      );
    };

    const renderListView = () => (
      <>
        {/* FuelQ Pricing Banner */}
        <View style={styles.fuelqPricingBanner}>
          <LinearGradient
            colors={['#7C3AED', '#6D28D9']}
            style={styles.fuelqPricingGradient}
          >
            <Text style={styles.fuelqPricingIcon}>⛽</Text>
            <View style={styles.fuelqPricingContent}>
              <Text style={styles.fuelqPricingTitle}>FuelQ Weekly Prices</Text>
              <View style={styles.fuelqPricingRow}>
                <View style={styles.fuelqPricingItem}>
                  <Text style={styles.fuelqFuelType}>Diesel</Text>
                  <Text style={styles.fuelqPrice}>
                    {FUELQ_WEEKLY_PRICES.diesel.toFixed(1)}p/L
                  </Text>
                  <Text style={styles.fuelqSaving}>Fixed Price</Text>
                  <Text style={styles.fuelqNote}>+3p at supermarkets</Text>
                </View>
                <View style={styles.fuelqPricingDivider} />
                <View style={styles.fuelqPricingItem}>
                  <Text style={styles.fuelqFuelType}>Petrol</Text>
                  <Text style={styles.fuelqPrice}>3p/L</Text>
                  <Text style={styles.fuelqSaving}>Savings</Text>
                  <Text style={styles.fuelqNote}>1p at supermarkets</Text>
                </View>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* National Average Cards */}
        <View style={styles.summaryCards}>
          <LinearGradient
            colors={['#3B82F6', '#2563EB']}
            style={[styles.summaryCard, styles.summaryCardSmall]}
          >
            <Text style={styles.summaryCardIcon}>⛽</Text>
            <Text style={styles.summaryCardTitle}>Petrol</Text>
            <Text style={styles.summaryCardPrice}>
              {(parseFloat(fuelPrices.petrolAverage) * 100).toFixed(1)}p
            </Text>
            <Text style={styles.summaryCardLabel}>UK Average</Text>
            <Text style={styles.summaryCardSubLabel}>inc VAT</Text>
          </LinearGradient>
          
          <LinearGradient
            colors={['#EF4444', '#DC2626']}
            style={[styles.summaryCard, styles.summaryCardSmall]}
          >
            <Text style={styles.summaryCardIcon}>🚗</Text>
            <Text style={styles.summaryCardTitle}>Diesel</Text>
            <Text style={styles.summaryCardPrice}>
              {(parseFloat(fuelPrices.dieselAverage) * 100).toFixed(1)}p
            </Text>
            <Text style={styles.summaryCardLabel}>UK Average</Text>
            <Text style={styles.summaryCardSubLabel}>inc VAT</Text>
          </LinearGradient>
          
          <LinearGradient
            colors={['#10B981', '#059669']}
            style={[styles.summaryCard, styles.summaryCardSmall]}
          >
            <Text style={styles.summaryCardIcon}>📍</Text>
            <Text style={styles.summaryCardTitle}>Stations</Text>
            <Text style={styles.summaryCardPrice}>
              {liveStationsCount}
            </Text>
            <Text style={styles.summaryCardLabel}>
              Live Pricing
            </Text>
          </LinearGradient>
        </View>

        <FlatList
          data={displayedStations}
          renderItem={renderStationItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>
                No UK Fuels partner stations found. Try adjusting your search.
              </Text>
            </View>
          }
        />
      </>
    );

    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>
            Loading fuel prices and UK Fuels sites...
          </Text>
          <Text style={styles.loadingProgress}>
            {loadingProgress.current}/{loadingProgress.total} completed
          </Text>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill, 
                { width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }
              ]} 
            />
          </View>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>Failed to load prices</Text>
          <Text style={styles.errorDetail}>
            This may be due to CORS restrictions. Try refreshing.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.mapScreenContainer}>
        <View style={styles.mapHeader}>
          <View style={styles.mapHeaderLeft}>
            <Text style={styles.mapTitle}>Station Finder</Text>
          </View>
          <View style={styles.mapFilters}>
            <TouchableOpacity 
              style={[styles.filterChip, viewMode === 'map' && styles.filterChipActive]}
              onPress={() => setViewMode('map')}
            >
              <Text style={[styles.filterText, viewMode === 'map' && styles.filterTextActive]}>🗺️ Map</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.filterChip, viewMode === 'list' && styles.filterChipActive]}
              onPress={() => setViewMode('list')}
            >
              <Text style={[styles.filterText, viewMode === 'list' && styles.filterTextActive]}>📋 List</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search stations..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#94A3B8"
          />
        </View>

        <View style={styles.mapContainer}>
          {viewMode === 'map' ? renderMapView() : renderListView()}
        </View>
      </View>
    );
  };

  const NewsScreen = () => (
    <ScrollView style={styles.screen} showsVerticalScrollIndicator={false}>
      <View style={styles.newsHeader}>
        <Text style={styles.newsTitle}>News & Updates</Text>
        <Text style={styles.newsSubtitle}>Stay informed about fuel markets and partnerships</Text>
      </View>

      {/* Featured News */}
      <View style={styles.featuredNewsCard}>
        <LinearGradient
          colors={['#8B5CF6', '#7C3AED']}
          style={styles.featuredNewsGradient}
        >
          <View style={styles.newsTag}>
            <Text style={styles.newsTagText}>PARTNERSHIP</Text>
          </View>
          <Text style={styles.featuredNewsTitle}>FuelQ Partners with Tesla Supercharger Network</Text>
          <Text style={styles.featuredNewsDesc}>
            Premium members now get exclusive 20% discount at all Tesla Supercharger locations across the UK
          </Text>
          <Text style={styles.newsDate}>2 days ago</Text>
        </LinearGradient>
      </View>

      {/* Market Updates */}
      <View style={styles.newsSection}>
        <Text style={styles.newsSectionTitle}>Fuel Market Updates</Text>
        
        <TouchableOpacity style={styles.newsCard} onPress={() => showToast('Full article coming soon!')}>
          <View style={styles.newsCardContent}>
            <Text style={styles.newsCardTag}>MARKET UPDATE</Text>
            <Text style={styles.newsCardTitle}>Diesel Prices Drop 5p This Week</Text>
            <Text style={styles.newsCardDesc}>
              UK diesel prices see significant drop due to increased supply...
            </Text>
            <Text style={styles.newsCardDate}>1 day ago</Text>
          </View>
          <Text style={styles.newsCardIcon}>📉</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.newsCard} onPress={() => showToast('Full article coming soon!')}>
          <View style={styles.newsCardContent}>
            <Text style={styles.newsCardTag}>ANALYSIS</Text>
            <Text style={styles.newsCardTitle}>EV Charging Costs vs Petrol: 2025 Report</Text>
            <Text style={styles.newsCardDesc}>
              Comprehensive analysis shows EV charging now 60% cheaper than petrol...
            </Text>
            <Text style={styles.newsCardDate}>3 days ago</Text>
          </View>
          <Text style={styles.newsCardIcon}>⚡</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const OffersScreen = () => (
    <ScrollView style={styles.screen} showsVerticalScrollIndicator={false}>
      <View style={styles.offersHeader}>
        <Text style={styles.offersTitle}>Exclusive Offers</Text>
        <Text style={styles.offersSubtitle}>Premium member benefits</Text>
      </View>

      <View style={styles.featuredOffer}>
        <LinearGradient
          colors={['#DC2626', '#B91C1C']}
          style={styles.featuredOfferGradient}
        >
          <View style={styles.offerBadge}>
            <Text style={styles.offerBadgeText}>LIMITED TIME</Text>
          </View>
          <Text style={styles.featuredOfferTitle}>Triple Points Weekend</Text>
          <Text style={styles.featuredOfferDesc}>
            Earn 3x loyalty points on all fuel purchases this weekend
          </Text>
          <View style={styles.offerTimer}>
            <View style={styles.timerBlock}>
              <Text style={styles.timerValue}>2</Text>
              <Text style={styles.timerLabel}>Days</Text>
            </View>
            <View style={styles.timerBlock}>
              <Text style={styles.timerValue}>14</Text>
              <Text style={styles.timerLabel}>Hours</Text>
            </View>
            <View style={styles.timerBlock}>
              <Text style={styles.timerValue}>32</Text>
              <Text style={styles.timerLabel}>Mins</Text>
            </View>
          </View>
        </LinearGradient>
      </View>

      <View style={styles.offerCategories}>
        {[
          { icon: '⛽', title: 'Fuel Savings', count: 5, color: '#3B82F6' },
          { icon: '🚗', title: 'Car Care', count: 8, color: '#8B5CF6' },
          { icon: '☕', title: 'Shop & Dine', count: 12, color: '#10B981' },
          { icon: '🎁', title: 'Rewards', count: 3, color: '#F59E0B' },
        ].map((category, index) => (
          <TouchableOpacity
            key={index}
            style={styles.offerCategory}
            onPress={() => showToast(`${category.title} offers coming soon!`)}
          >
            <LinearGradient
              colors={[category.color, category.color + 'DD']}
              style={styles.categoryGradient}
            >
              <Text style={styles.categoryIcon}>{category.icon}</Text>
              <Text style={styles.categoryTitle}>{category.title}</Text>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryCount}>{category.count}</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );

  const AccountScreen = () => (
    <>
      <ScrollView style={styles.screen} showsVerticalScrollIndicator={false}>
        <View style={styles.accountHeader}>
          <LinearGradient
            colors={['#1E293B', '#334155']}
            style={styles.accountHeaderGradient}
          >
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>JM</Text>
            </View>
            <Text style={styles.accountName}>James May</Text>
            <Text style={styles.accountEmail}>james.may@fuelq.com</Text>
            <View style={styles.membershipBadge}>
              <Text style={styles.membershipText}>PLATINUM MEMBER</Text>
            </View>
          </LinearGradient>
        </View>

        <View style={styles.accountStats}>
          <View style={styles.accountStat}>
            <Text style={styles.accountStatValue}>£1,040</Text>
            <Text style={styles.accountStatLabel}>Total Saved</Text>
          </View>
          <View style={styles.accountStatDivider} />
          <View style={styles.accountStat}>
            <Text style={styles.accountStatValue}>2.5 Years</Text>
            <Text style={styles.accountStatLabel}>Member Since</Text>
          </View>
        </View>

        {/* Premium Pre-funded Balance Card */}
        <View style={styles.balanceCard}>
          <LinearGradient
            colors={['#1E293B', '#334155']}
            style={styles.balanceCardGradient}
          >
            <View style={styles.balanceCardHeader}>
              <View style={styles.balanceCardBadge}>
                <Text style={styles.balanceCardBadgeText}>PREMIUM ACCOUNT</Text>
              </View>
              <Text style={styles.balanceCardIcon}>💎</Text>
            </View>
            
            <View style={styles.balanceCardMain}>
              <Text style={styles.balanceLabel}>Pre-funded Balance</Text>
              <Text style={styles.balanceAmount}>£545.50</Text>
            </View>
            
            <View style={styles.balanceCardDivider} />
            
            <View style={styles.balanceCardDetails}>
              <View style={styles.balanceDetailRow}>
                <Text style={styles.balanceDetailLabel}>Next Direct Debit</Text>
                <Text style={styles.balanceDetailValue}>£914.76</Text>
              </View>
              <View style={styles.balanceDetailRow}>
                <Text style={styles.balanceDetailLabel}>Payment Date</Text>
                <Text style={styles.balanceDetailValue}>03 May 2025</Text>
              </View>
              <View style={styles.balanceDetailRow}>
                <Text style={styles.balanceDetailLabel}>Monthly Average</Text>
                <Text style={styles.balanceDetailValue}>£872.43</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        <View style={styles.accountSection}>
          {/* Payment Management Section */}
          <View style={styles.settingsGroup}>
            <Text style={styles.settingsGroupTitle}>Payment Management</Text>
            
            {/* Payment Method */}
            <TouchableOpacity style={styles.paymentMethodCard} onPress={() => showToast('Direct Debit management coming soon!')}>
              <View style={styles.paymentMethodHeader}>
                <Text style={styles.paymentMethodIcon}>🏦</Text>
                <View style={styles.paymentMethodInfo}>
                  <Text style={styles.paymentMethodTitle}>Direct Debit</Text>
                  <Text style={styles.paymentMethodDetails}>Barclays •••• 4532</Text>
                </View>
                <View style={styles.paymentMethodStatus}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusTextActive}>Active</Text>
                </View>
              </View>
              <View style={styles.paymentMethodFooter}>
                <Text style={styles.paymentMethodLabel}>Next payment: £914.76 on 03 May 2025</Text>
              </View>
            </TouchableOpacity>

            {/* Transaction History */}
            <TouchableOpacity style={styles.managementItem} onPress={() => showToast('Transaction history coming soon!')}>
              <Text style={styles.managementIcon}>📊</Text>
              <View style={styles.managementContent}>
                <Text style={styles.managementTitle}>Transaction History</Text>
                <Text style={styles.managementSubtitle}>View all fuel purchases and payments</Text>
              </View>
              <Text style={styles.managementArrow}>→</Text>
            </TouchableOpacity>

            {/* Invoice Management */}
            <TouchableOpacity style={styles.managementItem} onPress={() => showToast('Invoice management coming soon!')}>
              <Text style={styles.managementIcon}>📄</Text>
              <View style={styles.managementContent}>
                <Text style={styles.managementTitle}>Invoice Management</Text>
                <Text style={styles.managementSubtitle}>Download invoices and statements</Text>
              </View>
              <Text style={styles.managementArrow}>→</Text>
            </TouchableOpacity>
          </View>

          {/* Vehicle Fleet */}
          <View style={styles.settingsGroup}>
            <Text style={styles.settingsGroupTitle}>Vehicle Fleet</Text>
            
            {vehicles.map((vehicle) => (
              <TouchableOpacity 
                key={vehicle.id} 
                style={[styles.vehicleCard, !vehicle.isActive && styles.vehicleCardInactive]} 
                onPress={() => showToast(`Vehicle ${vehicle.plate} details coming soon!`)}
              >
                <Text style={styles.vehicleIcon}>{vehicle.icon}</Text>
                <View style={styles.vehicleInfo}>
                  <View style={styles.vehicleHeader}>
                    <Text style={styles.vehiclePlate}>{vehicle.plate}</Text>
                    <TouchableOpacity 
                      style={[styles.vehicleToggle, vehicle.isActive && styles.vehicleToggleActive]}
                      onPress={(e) => {
                        e.stopPropagation();
                        const updatedVehicles = vehicles.map(v => 
                          v.id === vehicle.id ? { ...v, isActive: !v.isActive } : v
                        );
                        setVehicles(updatedVehicles);
                        showToast(vehicle.isActive ? '🚗 Vehicle deactivated' : '✅ Vehicle activated');
                      }}
                    >
                      <View style={[styles.toggleDot, vehicle.isActive && styles.toggleDotActive]} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.vehicleDetails}>{vehicle.details}</Text>
                  <View style={styles.vehicleFuelCard}>
                    <Text style={styles.vehicleFuelCardIcon}>💳</Text>
                    <Text style={styles.vehicleFuelCardText}>Fuel Card •••• {vehicle.fuelCardLast4}</Text>
                  </View>
                </View>
                <Text style={styles.vehicleArrow}>→</Text>
              </TouchableOpacity>
            ))}
            
            <TouchableOpacity 
              style={styles.addVehicleButton} 
              onPress={() => setShowAddVehicleModal(true)}
            >
              <Text style={styles.addVehicleIcon}>+</Text>
              <Text style={styles.addVehicleText}>Add Premium Vehicle</Text>
            </TouchableOpacity>
          </View>

          {/* Other Settings */}
          <View style={styles.settingsGroup}>
            <Text style={styles.settingsGroupTitle}>Other Settings</Text>
            {[
              { icon: '🔔', title: 'Notifications', subtitle: 'Manage alerts and updates' },
              { icon: '🔐', title: 'Security', subtitle: 'Password and authentication' },
              { icon: '❓', title: 'Help & Support', subtitle: '24/7 premium support' },
            ].map((item, index) => (
              <TouchableOpacity
                key={index}
                style={styles.accountItem}
                onPress={() => showToast(`${item.title} coming soon!`)}
              >
                <Text style={styles.accountItemIcon}>{item.icon}</Text>
                <View style={styles.accountItemContent}>
                  <Text style={styles.accountItemTitle}>{item.title}</Text>
                  <Text style={styles.accountItemSubtitle}>{item.subtitle}</Text>
                </View>
                <Text style={styles.accountItemArrow}>→</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleLogout}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Add Vehicle Modal */}
      <Modal
        visible={showAddVehicleModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAddVehicleModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalBackdrop} 
            onPress={() => setShowAddVehicleModal(false)}
            activeOpacity={1}
          />
          <View style={styles.addVehicleModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Vehicle</Text>
              <TouchableOpacity onPress={() => setShowAddVehicleModal(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.modalContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Vehicle Registration</Text>
                <TextInput
                  ref={plateInputRef}
                  style={styles.input}
                  placeholder="e.g. AB12 CDE"
                  placeholderTextColor="#94A3B8"
                  value={newVehicle.plate}
                  onChangeText={(text) => setNewVehicle(prev => ({...prev, plate: text}))}
                  autoCapitalize="characters"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Make</Text>
                <TextInput
                  ref={makeInputRef}
                  style={styles.input}
                  placeholder="e.g. BMW"
                  placeholderTextColor="#94A3B8"
                  value={newVehicle.make}
                  onChangeText={(text) => setNewVehicle(prev => ({...prev, make: text}))}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Model</Text>
                <TextInput
                  ref={modelInputRef}
                  style={styles.input}
                  placeholder="e.g. 3 Series"
                  placeholderTextColor="#94A3B8"
                  value={newVehicle.model}
                  onChangeText={(text) => setNewVehicle(prev => ({...prev, model: text}))}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Fuel Type</Text>
                <View style={styles.fuelTypeOptions}>
                  {['Diesel', 'Petrol', 'Electric'].map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.fuelTypeOption,
                        newVehicle.fuelType === type.toLowerCase() && styles.fuelTypeOptionActive
                      ]}
                      onPress={() => setNewVehicle(prev => ({...prev, fuelType: type.toLowerCase()}))}
                    >
                      <Text style={[
                        styles.fuelTypeText,
                        newVehicle.fuelType === type.toLowerCase() && styles.fuelTypeTextActive
                      ]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Fuel Card Number</Text>
                <TextInput
                  ref={cardNumberInputRef}
                  style={styles.input}
                  placeholder="16-digit card number"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  maxLength={16}
                  value={newVehicle.cardNumber}
                  onChangeText={(text) => setNewVehicle(prev => ({...prev, cardNumber: text.replace(/\D/g, '')}))}
                />
              </View>

              <TouchableOpacity 
                style={styles.saveVehicleButton}
                onPress={() => {
                  if (newVehicle.plate && newVehicle.make && newVehicle.model) {
                    const newVehicleData = {
                      id: Date.now().toString(),
                      plate: newVehicle.plate.toUpperCase(),
                      details: `${newVehicle.make} ${newVehicle.model} • ${newVehicle.fuelType.charAt(0).toUpperCase() + newVehicle.fuelType.slice(1)}`,
                      fuelCardLast4: newVehicle.cardNumber.slice(-4) || '0000',
                      isActive: true,
                      icon: newVehicle.fuelType === 'electric' ? '🚙' : '🚗',
                    };
                    setVehicles([...vehicles, newVehicleData]);
                    showToast('✅ Vehicle added successfully!');
                    setShowAddVehicleModal(false);
                    setNewVehicle({
                      plate: '',
                      make: '',
                      model: '',
                      fuelType: 'diesel',
                      cardNumber: '',
                      isActive: true,
                    });
                  } else {
                    showToast('⚠️ Please fill in all required fields');
                  }
                }}
              >
                <Text style={styles.saveVehicleText}>Add Vehicle</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );

  const BottomNavigation = () => (
    <View style={styles.bottomNav}>
      {[
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'map', icon: '⛽', label: 'Stations' },
        { id: 'news', icon: '📄', label: 'News' },
        { id: 'offers', icon: '🎁', label: 'Offers' },
        { id: 'account', icon: '⚙️', label: 'Account' },
      ].map((item) => {
        const isRestricted = userType === 'guest' && item.id !== 'map';
        
        return (
          <TouchableOpacity
            key={item.id}
            style={styles.navItem}
            onPress={() => {
              if (isRestricted) {
                setRestrictedScreen(item.id);
                setShowRestrictedModal(true);
              } else {
                setActiveScreen(item.id);
              }
            }}
          >
            <View style={[
              styles.navIconWrapper, 
              activeScreen === item.id && styles.navIconWrapperActive,
              isRestricted && styles.navIconWrapperRestricted
            ]}>
              <Text style={[
                styles.navIcon, 
                activeScreen === item.id && styles.navIconActive,
                isRestricted && styles.navIconRestricted
              ]}>
                {item.icon}
              </Text>
              {isRestricted && (
                <View style={styles.navLockBadge}>
                  <Text style={styles.navLockIcon}>🔒</Text>
                </View>
              )}
            </View>
            <Text style={[
              styles.navLabel, 
              activeScreen === item.id && styles.navLabelActive,
              isRestricted && styles.navLabelRestricted
            ]}>
              {item.label}
            </Text>
            {activeScreen === item.id && <View style={styles.navIndicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderScreen = () => {
    if (userType === 'guest' && activeScreen !== 'map') {
      return (
        <View style={styles.screen}>
          {activeScreen === 'dashboard' && <DashboardScreen />}
          {activeScreen === 'news' && <NewsScreen />}
          {activeScreen === 'offers' && <OffersScreen />}
          {activeScreen === 'account' && <AccountScreen />}
          <RestrictedOverlay screen={activeScreen} />
        </View>
      );
    }
    
    switch (activeScreen) {
      case 'dashboard': return <DashboardScreen />;
      case 'map': return <MapScreen />;
      case 'news': return <NewsScreen />;
      case 'offers': return <OffersScreen />;
      case 'account': return <AccountScreen />;
      default: return <DashboardScreen />;
    }
  };

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <SafeAreaView style={styles.safeArea}>
        {renderScreen()}
        <BottomNavigation />
      </SafeAreaView>
      <RestrictedModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  screen: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    paddingHorizontal: 15,
    paddingBottom: 100,
  },
  
  // Logo Styles
  logoContainer: {
    marginTop: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  logoTagline: {
    fontSize: 18,
    color: '#94A3B8',
    letterSpacing: 1,
    fontWeight: '500',
  },
  
  // Welcome Section
  welcomeSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  welcomeContent: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 16,
    color: '#94A3B8',
    marginBottom: 4,
  },
  userName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileButton: {
    marginLeft: 20,
  },
  profileGradient: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  
  // Savings Card
  savingsCardWrapper: {
    marginBottom: 20,
  },
  savingsCard: {
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  savingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  savingsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  savingsBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  savingsBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 1,
  },
  savingsTabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  savingsTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    marginHorizontal: 5,
  },
  savingsTabActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  savingsTabIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  savingsTabText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  savingsTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  savingsContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  savingsAmount: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  savingsLabel: {
    fontSize: 16,
    color: '#E2E8F0',
    marginBottom: 4,
  },
  savingsBreakdown: {
    fontSize: 13,
    color: '#94A3B8',
  },
  cashBackBanner: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  cashBackContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cashBackTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
    marginBottom: 4,
  },
  cashBackAmount: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  redeemButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  redeemButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  
  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  seeAllButton: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '500',
  },
  
  // Station Card
  stationCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    marginHorizontal: 0,
  },
  stationCardPremium: {
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  stationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  stationInfo: {
    flex: 1,
    marginRight: 16,
  },
  stationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  stationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  stationDistance: {
    fontSize: 12,
    color: '#94A3B8',
  },
  stationPricing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  fuelPriceColumn: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  fuelTypeLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 4,
    fontWeight: '600',
  },
  priceDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    marginHorizontal: 8,
  },
  pumpPrice: {
    fontSize: 12,
    color: '#64748B',
    textDecorationLine: 'line-through',
    marginTop: -2,
    marginBottom: 4,
  },
  selectedStationSiteNo: {
    fontSize: 12,
    color: '#3B82F6',
    marginTop: 2,
    fontWeight: '600',
  },
  selectedPumpPrice: {
    fontSize: 12,
    color: '#64748B',
    textDecorationLine: 'line-through',
    marginTop: -2,
    marginBottom: 4,
  },
  currentPrice: {
    fontSize: 20,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 2,
  },
  marketPrice: {
    fontSize: 12,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
    marginBottom: 6,
  },
  savingBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  savingText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10B981',
  },
  stationAmenities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  amenityChip: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  amenityText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  ukFuelsChip: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  ukFuelsChipText: {
    color: '#3B82F6',
    fontWeight: '600',
  },
  navigateButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  navigateButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  
  // Map Screen
  mapScreenContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  mapHeader: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mapHeaderLeft: {
    flex: 1,
  },
  mapTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mapSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  mapFilters: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  filterChipActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3B82F6',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  
  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    marginHorizontal: 15,
    marginTop: 10,
    marginBottom: 10,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  searchIcon: {
    marginRight: 10,
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#FFFFFF',
  },
  
  // Summary Cards
  summaryCards: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingTop: 10,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  summaryCardSmall: {
    padding: 12,
  },
  summaryCardIcon: {
    fontSize: 20,
    marginBottom: 6,
  },
  summaryCardTitle: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 2,
    fontWeight: '600',
  },
  summaryCardPrice: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginTop: 2,
  },
  summaryCardLabel: {
    fontSize: 10,
    color: '#FFFFFF',
    opacity: 0.9,
    marginTop: 2,
  },
  summaryCardSubLabel: {
    fontSize: 9,
    color: '#FFFFFF',
    opacity: 0.7,
    fontStyle: 'italic',
  },
  
  // FuelQ Pricing Banner
  fuelqPricingBanner: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 5,
  },
  fuelqPricingGradient: {
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fuelqPricingIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  fuelqPricingContent: {
    flex: 1,
  },
  fuelqPricingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  fuelqPricingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fuelqPricingItem: {
    flex: 1,
    alignItems: 'center',
  },
  fuelqPricingDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 16,
  },
  fuelqFuelType: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.8,
    marginBottom: 2,
  },
  fuelqPrice: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  fuelqSaving: {
    fontSize: 11,
    color: '#10B981',
    fontWeight: '600',
  },
  fuelqNote: {
    fontSize: 10,
    color: '#FFFFFF',
    opacity: 0.7,
    marginTop: 2,
    fontStyle: 'italic',
  },
  
  listContent: {
    paddingBottom: 20,
  },
  
  // Account Screen
  accountHeader: {
    marginBottom: 20,
  },
  accountHeaderGradient: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginHorizontal: 15,
  },
  accountAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  accountAvatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  accountName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  accountEmail: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 16,
  },
  membershipBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  membershipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A855F7',
    letterSpacing: 1,
  },
  accountStats: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    marginHorizontal: 15,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  accountStat: {
    flex: 1,
    alignItems: 'center',
  },
  accountStatValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  accountStatLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  accountStatDivider: {
    width: 1,
    backgroundColor: '#334155',
    marginHorizontal: 20,
  },
  
  // Bottom Navigation
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1E293B',
    flexDirection: 'row',
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  navIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    marginBottom: 4,
    overflow: 'hidden', // Ensure content stays within rounded corners
  },
  navIconWrapperActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  navIcon: {
    fontSize: 20,
    color: '#64748B',
  },
  navIconActive: {
    color: '#3B82F6',
  },
  navLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#3B82F6',
    fontWeight: '600',
  },
  navIndicator: {
    position: 'absolute',
    top: -8,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3B82F6',
  },
  
  // News Screen Styles
  newsHeader: {
    paddingHorizontal: 15,
    paddingTop: 16,
    paddingBottom: 24,
  },
  newsTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  newsSubtitle: {
    fontSize: 16,
    color: '#94A3B8',
  },
  featuredNewsCard: {
    paddingHorizontal: 15,
    marginBottom: 24,
  },
  featuredNewsGradient: {
    borderRadius: 20,
    padding: 24,
  },
  newsTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  newsTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  featuredNewsTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  featuredNewsDesc: {
    fontSize: 16,
    color: '#FFFFFF',
    opacity: 0.9,
    lineHeight: 24,
    marginBottom: 16,
  },
  newsDate: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.7,
  },
  newsSection: {
    paddingHorizontal: 15,
    marginBottom: 24,
  },
  newsSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  newsCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
  },
  newsCardContent: {
    flex: 1,
    marginRight: 16,
  },
  newsCardTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3B82F6',
    letterSpacing: 1,
    marginBottom: 8,
  },
  newsCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  newsCardDesc: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 20,
    marginBottom: 8,
  },
  newsCardDate: {
    fontSize: 12,
    color: '#64748B',
  },
  newsCardIcon: {
    fontSize: 32,
    alignSelf: 'center',
  },
  
  // Offers Screen
  offersHeader: {
    paddingHorizontal: 15,
    paddingTop: 16,
    paddingBottom: 24,
  },
  offersTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  offersSubtitle: {
    fontSize: 16,
    color: '#94A3B8',
  },
  featuredOffer: {
    paddingHorizontal: 15,
    marginBottom: 24,
  },
  featuredOfferGradient: {
    borderRadius: 20,
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  offerBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  offerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  featuredOfferTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  featuredOfferDesc: {
    fontSize: 16,
    color: '#FFFFFF',
    opacity: 0.9,
    marginBottom: 20,
  },
  offerTimer: {
    flexDirection: 'row',
    gap: 16,
  },
  timerBlock: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  timerValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  timerLabel: {
    fontSize: 11,
    color: '#FFFFFF',
    opacity: 0.8,
  },
  offerCategories: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 15,
    marginBottom: 24,
    gap: 10,
  },
  offerCategory: {
    width: (width - 40) / 2,
  },
  categoryGradient: {
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    position: 'relative',
  },
  categoryIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  categoryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  categoryBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  categoryCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  
  // Map View Styles
  mapWrapper: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  mapInfoOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mapInfoText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  mapInfoSubtext: {
    fontSize: 12,
    color: '#3B82F6',
    marginTop: 2,
  },
  mapMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  mapMarkerUKFuels: {
    backgroundColor: '#3B82F6',
  },
  mapMarkerSelected: {
    borderColor: '#F59E0B',
    borderWidth: 4,
    transform: [{ scale: 1.1 }],
  },
  mapMarkerText: {
    fontSize: 18,
  },
  calloutContainer: {
    width: 200,
    padding: 10,
  },
  calloutTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#1E293B',
  },
  calloutUKFuelsBadge: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 5,
  },
  calloutUKFuelsText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  calloutFuelQPrice: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: 'bold',
    marginBottom: 2,
  },
  calloutPumpPrice: {
    fontSize: 12,
    color: '#64748B',
    textDecorationLine: 'line-through',
    marginBottom: 2,
  },
  calloutSaving: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600',
    marginBottom: 5,
  },
  calloutPrice: {
    fontSize: 18,
    color: '#10B981',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  calloutAddress: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 5,
  },
  calloutSiteNo: {
    fontSize: 11,
    color: '#3B82F6',
    fontWeight: '600',
    marginBottom: 10,
  },
  calloutButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    alignItems: 'center',
  },
  calloutButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    backgroundColor: '#0F172A',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
  },
  loadingProgress: {
    marginTop: 10,
    fontSize: 14,
    color: '#64748B',
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    marginTop: 15,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 3,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    backgroundColor: '#0F172A',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 10,
  },
  errorText: {
    marginTop: 10,
    fontSize: 16,
    color: '#EF4444',
    fontWeight: '600',
  },
  errorDetail: {
    marginTop: 10,
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: '#3B82F6',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 25,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  noDataContainer: {
    padding: 60,
    alignItems: 'center',
  },
  noStationsMessage: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    marginBottom: 20,
  },
  noStationsText: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
  },
  brandBadgeText: {
    fontSize: 12,
    color: '#94A3B8',
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  siteNumberText: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '600',
  },
  noPriceText: {
    fontSize: 14,
    color: '#64748B',
    fontStyle: 'italic',
  },
  bandChip: {
    backgroundColor: '#F59E0B20',
    borderColor: '#F59E0B40',
    borderWidth: 1,
  },
  
  // Selected Station Bar
  selectedStationBar: {
    position: 'absolute',
    bottom: 80, // Moved up to account for bottom navigation
    left: 0,
    right: 0,
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    maxHeight: height * 0.4, // Reduced max height
  },
  selectedStationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  selectedStationInfo: {
    flex: 1,
    marginRight: 16,
  },
  selectedStationName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  selectedStationAddress: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 18,
  },
  closeButton: {
    padding: 8,
    marginTop: -8,
    marginRight: -8,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#64748B',
  },
  selectedStationPricing: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedFuelPrice: {
    flex: 1,
    alignItems: 'center',
  },
  selectedFuelType: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 6,
    fontWeight: '600',
  },
  selectedPrice: {
    fontSize: 28,
    fontWeight: '700',
    color: '#3B82F6',
    marginBottom: 4,
  },
  selectedSaving: {
    fontSize: 13,
    color: '#10B981',
    fontWeight: '600',
  },
  selectedPriceDivider: {
    width: 1,
    height: 60,
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    marginHorizontal: 20,
  },
  selectedNavigateButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12, // Add margin to separate from content above
  },
  selectedNavigateText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  selectedStationContent: {
    paddingBottom: 0, // Removed extra padding since we positioned the bar higher
  },
  
  // Quick Stats
  quickStats: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 12,
  },
  statItem: {
    flex: 1,
  },
  statGradient: {
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  statTapHint: {
    fontSize: 10,
    color: '#FFFFFF',
    opacity: 0.6,
    marginTop: 4,
  },
  
  // Trend Card
  trendCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 25,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  trendTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  trendViewMore: {
    fontSize: 13,
    color: '#3B82F6',
    fontWeight: '500',
  },
  trendScroll: {
    marginHorizontal: -8,
  },
  trendItem: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginHorizontal: 6,
    alignItems: 'center',
    minWidth: 80,
  },
  trendItemCurrent: {
    backgroundColor: '#3B82F6',
  },
  trendWeek: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 4,
    fontWeight: '500',
  },
  trendWeekCurrent: {
    color: '#FFFFFF',
  },
  trendPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  trendPriceCurrent: {
    color: '#FFFFFF',
  },
  trendChange: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  trendChangeUp: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  trendChangeDown: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  trendChangeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  
  // Premium Banner
  premiumBanner: {
    marginTop: 20,
    marginBottom: 20,
  },
  premiumBannerGradient: {
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  premiumBannerContent: {
    flex: 1,
  },
  premiumBannerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  premiumBannerSubtitle: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  premiumBannerArrow: {
    fontSize: 24,
    color: '#FFFFFF',
    marginLeft: 16,
  },
  
  // Balance Card
  balanceCard: {
    marginHorizontal: 15,
    marginBottom: 20,
  },
  balanceCardGradient: {
    borderRadius: 16,
    padding: 20,
  },
  balanceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  balanceCardBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  balanceCardBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A855F7',
    letterSpacing: 1,
  },
  balanceCardIcon: {
    fontSize: 28,
  },
  balanceCardMain: {
    alignItems: 'center',
    marginBottom: 20,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  balanceCardDivider: {
    height: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    marginBottom: 20,
  },
  balanceCardDetails: {
    gap: 12,
  },
  balanceDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceDetailLabel: {
    fontSize: 14,
    color: '#94A3B8',
  },
  balanceDetailValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  
  // Account Section
  accountSection: {
    paddingHorizontal: 15,
    paddingBottom: 20,
  },
  settingsGroup: {
    marginBottom: 24,
  },
  settingsGroupTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  
  // Payment Method Card
  paymentMethodCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  paymentMethodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  paymentMethodIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  paymentMethodInfo: {
    flex: 1,
  },
  paymentMethodTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  paymentMethodDetails: {
    fontSize: 14,
    color: '#94A3B8',
  },
  paymentMethodStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  statusTextActive: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600',
  },
  paymentMethodFooter: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    marginHorizontal: -16,
    marginBottom: -16,
    padding: 12,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  paymentMethodLabel: {
    fontSize: 13,
    color: '#3B82F6',
    textAlign: 'center',
  },
  
  // Management Items
  managementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  managementIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  managementContent: {
    flex: 1,
  },
  managementTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  managementSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
  },
  managementArrow: {
    fontSize: 20,
    color: '#64748B',
  },
  
  // Vehicle Cards
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  vehicleCardInactive: {
    opacity: 0.6,
  },
  vehicleIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  vehiclePlate: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  vehicleToggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#334155',
    padding: 2,
  },
  vehicleToggleActive: {
    backgroundColor: '#10B981',
  },
  toggleDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#64748B',
  },
  toggleDotActive: {
    backgroundColor: '#FFFFFF',
    marginLeft: 20,
  },
  vehicleDetails: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 8,
  },
  vehicleFuelCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleFuelCardIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  vehicleFuelCardText: {
    fontSize: 12,
    color: '#64748B',
  },
  vehicleArrow: {
    fontSize: 20,
    color: '#64748B',
    marginLeft: 12,
  },
  
  // Add Vehicle Button
  addVehicleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderStyle: 'dashed',
  },
  addVehicleIcon: {
    fontSize: 20,
    color: '#3B82F6',
    marginRight: 8,
    fontWeight: '700',
  },
  addVehicleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3B82F6',
  },
  
  // Account Items
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  accountItemIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  accountItemContent: {
    flex: 1,
  },
  accountItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  accountItemSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
  },
  accountItemArrow: {
    fontSize: 20,
    color: '#64748B',
  },
  
  // Sign Out Button
  signOutButton: {
    marginHorizontal: 15,
    marginTop: 16,
    marginBottom: 32,
    backgroundColor: '#EF4444',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  addVehicleModal: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: height * 0.8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.2)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalClose: {
    padding: 8,
  },
  modalCloseText: {
    fontSize: 24,
    color: '#64748B',
  },
  modalContent: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  fuelTypeOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  fuelTypeOption: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  fuelTypeOptionActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: '#3B82F6',
  },
  fuelTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  fuelTypeTextActive: {
    color: '#3B82F6',
  },
  saveVehicleButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  saveVehicleText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  
  // Login Screen Styles
  loginContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loginSafeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loginScrollView: {
    flex: 1,
  },
  loginScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20, // Reduced vertical padding
    minHeight: height - 100,
  },
  loginContentWrapper: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  loginLogoSection: {
    alignItems: 'center',
    marginBottom: 30, // Reduced from 40
  },
  loginLogoContainer: {
    width: 100,
    height: 100,
    borderRadius: 22, // App icon style rounded corners (22% of width)
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 5,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    overflow: 'hidden', // Ensure logo stays within rounded corners
  },
  loginLogo: {
    width: 70,
    height: 70,
  },
  loginLogoText: {
    fontSize: 40,
  },
  loginTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  loginTagline: {
    fontSize: 16,
    color: '#94A3B8',
    letterSpacing: 1,
  },
  loginCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20, // Reduced from 24
    marginBottom: 16, // Reduced from 20
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  loginCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16, // Reduced from 20
  },
  loginCardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  memberBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  memberBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3B82F6',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  inputIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  loginInput: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: '#FFFFFF',
  },
  eyeButton: {
    padding: 8,
  },
  eyeIcon: {
    fontSize: 20,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  forgotPassword: {
    alignItems: 'center',
  },
  forgotPasswordText: {
    fontSize: 14,
    color: '#3B82F6',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16, // Reduced from 20
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
  },
  dividerText: {
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  guestCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 20,
    padding: 20, // Reduced from 24
    marginBottom: 16, // Reduced from 20
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  guestBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  guestBadgeText: {
    color: '#94A3B8',
  },
  guestDescription: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 16, // Reduced from 20
    lineHeight: 20,
  },
  guestButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#3B82F6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  guestButtonText: {
    color: '#3B82F6',
  },
  registerSection: {
    alignItems: 'center',
    marginTop: 16, // Reduced from 20
    paddingBottom: 20, // Add padding at bottom
  },
  registerText: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 8,
  },
  registerLink: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
  },
  
  // Restricted Overlay Styles
  restrictedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  blurContent: {
    alignItems: 'center',
  },
  lockIconSmall: {
    fontSize: 48,
    opacity: 0.5,
  },
  restrictedModalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 32,
    width: '90%',
    maxWidth: 400,
    alignSelf: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  modalCloseButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
    zIndex: 1,
  },
  restrictedModalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  lockIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  restrictedTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  restrictedModalText: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  featuresList: {
    width: '100%',
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 16,
    width: 32,
  },
  featureText: {
    fontSize: 16,
    color: '#E2E8F0',
    flex: 1,
  },
  applyNowButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 20,
    paddingHorizontal: 48,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  applyNowButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  applyNowSubtext: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  continueGuestButton: {
    paddingVertical: 12,
  },
  continueGuestText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
  },
  navIconWrapperRestricted: {
    opacity: 0.5,
  },
  navIconRestricted: {
    opacity: 0.5,
  },
  navLabelRestricted: {
    opacity: 0.5,
  },
  navLockBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLockIcon: {
    fontSize: 10,
  },
  noDataText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
});