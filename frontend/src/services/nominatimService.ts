import axios, { AxiosInstance } from 'axios';
import { NominatimResult, LatLng } from '../types';

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

class NominatimService {
  private readonly axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: NOMINATIM_BASE_URL,
      headers: {
        'User-Agent': 'HackathonMapApp/1.0',
      },
      timeout: 10000,
    });
  }

  /**
   * Search for locations by name
   * @param query - Search query (city name, region, address, etc.)
   * @param limit - Maximum number of results
   * @returns Promise with array of search results
   */
  async search(query: string, limit: number = 10): Promise<NominatimResult[]> {
    try {
      const response = await this.axiosInstance.get<NominatimResult[]>(
        '/search',
        {
          params: {
            q: query,
            format: 'json',
            limit,
            extratags: 1,
            namedetails: 1,
          },
        }
      );
      return response.data;
    } catch (error) {
      console.error('Nominatim search error:', error);
      throw new Error(`Failed to search for "${query}"`);
    }
  }

  /**
   * Reverse geocode: get location name from coordinates
   * @param lat - Latitude
   * @param lng - Longitude
   * @returns Promise with location details
   */
  async reverseGeocode(lat: number, lng: number): Promise<NominatimResult | null> {
    try {
      const response = await this.axiosInstance.get<NominatimResult>(
        '/reverse',
        {
          params: {
            lat,
            lon: lng,
            format: 'json',
            zoom: 10,
          },
        }
      );
      return response.data;
    } catch (error) {
      console.error('Nominatim reverse geocode error:', error);
      return null;
    }
  }

  /**
   * Convert search result to LatLng
   * @param result - NominatimResult from search
   * @returns LatLng coordinates
   */
  resultToLatLng(result: NominatimResult): LatLng {
    return {
      lat: Number.parseFloat(result.lat),
      lng: Number.parseFloat(result.lon),
    };
  }
}

// Export singleton instance
export const nominatimService = new NominatimService();
