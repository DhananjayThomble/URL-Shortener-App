'use client';

import {
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemText,
  LinearProgress,
  Box,
} from '@mui/material';

interface Country {
  country: string;
  clicks: number;
}

interface TopCountriesWidgetProps {
  countries: Country[];
}

export function TopCountriesWidget({ countries }: TopCountriesWidgetProps) {
  // If no data provided, use mock data
  const mockCountries: Country[] = [
    { country: 'United States', clicks: 12450 },
    { country: 'United Kingdom', clicks: 8320 },
    { country: 'Germany', clicks: 6890 },
    { country: 'France', clicks: 5670 },
    { country: 'Canada', clicks: 4320 },
    { country: 'Australia', clicks: 3890 },
    { country: 'Japan', clicks: 3450 },
    { country: 'Netherlands', clicks: 2890 },
  ];

  const displayCountries = countries.length > 0 ? countries : mockCountries;
  const maxClicks = Math.max(...displayCountries.map(c => c.clicks));

  const getCountryFlag = (country: string) => {
    const flagMap: Record<string, string> = {
      'United States': '🇺🇸',
      'United Kingdom': '🇬🇧',
      'Germany': '🇩🇪',
      'France': '🇫🇷',
      'Canada': '🇨🇦',
      'Australia': '🇦🇺',
      'Japan': '🇯🇵',
      'Netherlands': '🇳🇱',
      'Spain': '🇪🇸',
      'Italy': '🇮🇹',
      'Brazil': '🇧🇷',
      'India': '🇮🇳',
      'China': '🇨🇳',
      'Russia': '🇷🇺',
      'South Korea': '🇰🇷',
    };
    return flagMap[country] || '🌍';
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Top Countries
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Click distribution by country
        </Typography>

        <List>
          {displayCountries.slice(0, 8).map((country, index) => (
            <ListItem key={country.country} sx={{ px: 0, py: 1 }}>
              <Box sx={{ width: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontSize: '1.2em' }}>
                      {getCountryFlag(country.country)}
                    </Typography>
                    <Typography variant="body2" fontWeight="medium">
                      {country.country}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {country.clicks.toLocaleString()}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(country.clicks / maxClicks) * 100}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: 'grey.200',
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 3,
                      bgcolor: index === 0 ? 'primary.main' : 
                               index === 1 ? 'secondary.main' : 
                               index === 2 ? 'success.main' : 'info.main',
                    },
                  }}
                />
              </Box>
            </ListItem>
          ))}
        </List>

        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography
            variant="body2"
            color="primary"
            sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          >
            View All Countries
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}