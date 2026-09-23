/**
 * Safety Net — TypeScript Type Definitions
 * Contracts for Emergency SOS, Indian Highway Route Planner, Check-in Switch, and AI Distress Companion.
 */

export interface Contact {
  name: string;
  phone: string;
  email: string;
  relation: string;
}

export interface SOSEvent {
  id: string;
  timestamp: string;
  coords: {
    lat: number;
    lng: number;
    accuracy?: number;
  };
  mapsUrl: string;
  recipients: {
    whatsapp: string[];
    email: string[];
  };
  status: "dispatched" | "failed" | "cancelled";
}

export interface POIFeature {
  id: string;
  name: string;
  type: "police" | "hospital" | "fuel" | "rest_stop";
  lat: number;
  lng: number;
  distanceKm?: number;
  phone?: string;
  open24x7: boolean;
}

export interface HighwaySafetyReport {
  score: number;
  highwayRatio: number;
  litArterialRatio: number;
  nightRiskMultiplier: number;
  isNight: boolean;
  recommendation: "HIGHWAY_SAFE_CORRIDOR" | "STANDARD_ROUTE" | "UNLIT_LOCAL_CAUTION";
  safestRoadSteps: string[];
  poisEnRoute: POIFeature[];
}

export interface CheckinSession {
  isActive: boolean;
  durationMinutes: number;
  remainingSeconds: number;
  armedAt: string;
  alertContactName: string;
  alertContactPhone: string;
  alertContactEmail: string;
}

export interface TripPoint {
  lat: number;
  lng: number;
  time: number;
  accuracy: number;
  speed: number | null;
  altitude: number | null;
}

export interface RouteHistoryTrip {
  id: string;
  startTime: number;
  endTime: number;
  distanceKm: number;
  durationSeconds: number;
  averageSpeedKmh: number;
  points: TripPoint[];
}

export interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  emergencyActionRequired?: boolean;
}
