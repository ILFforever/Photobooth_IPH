// Mock frame templates for testing

import { Frame, FrameZone } from '../types/frame';

export const mockFrames: Frame[] = [
  // 1. Single Circle Frame
  {
    id: 'mock-single-circle',
    name: 'Single Circle',
    description: 'A single circular photo in the center',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 350,
        y: 400,
        width: 500,
        height: 500,
        rotation: 0,
        shape: 'circle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 2. Three Vertical Strips
  {
    id: 'mock-three-strips',
    name: 'Three Vertical Strips',
    description: 'Three equal vertical photo strips',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 50,
        y: 100,
        width: 333,
        height: 1600,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 25,
      },
      {
        id: 'zone-2',
        x: 408,
        y: 100,
        width: 334,
        height: 1600,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 25,
      },
      {
        id: 'zone-3',
        x: 767,
        y: 100,
        width: 333,
        height: 1600,
        rotation: 0,
        shape: 'rectangle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 3. Diamond Layout
  {
    id: 'mock-diamond',
    name: 'Diamond Layout',
    description: 'Four photos in a diamond pattern',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 500,
        y: 100,
        width: 200,
        height: 200,
        rotation: 0,
        shape: 'rounded_rect',
        margin_bottom: 50,
      },
      {
        id: 'zone-2',
        x: 800,
        y: 400,
        width: 200,
        height: 200,
        rotation: 0,
        shape: 'rounded_rect',
      },
      {
        id: 'zone-3',
        x: 500,
        y: 700,
        width: 200,
        height: 200,
        rotation: 0,
        shape: 'rounded_rect',
        margin_right: 50,
      },
      {
        id: 'zone-4',
        x: 200,
        y: 400,
        width: 200,
        height: 200,
        rotation: 0,
        shape: 'rounded_rect',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 4. Film Strip Horizontal
  {
    id: 'mock-film-strip',
    name: 'Film Strip',
    description: 'Horizontal film strip with 4 photos',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 100,
        y: 800,
        width: 220,
        height: 200,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 30,
      },
      {
        id: 'zone-2',
        x: 350,
        y: 800,
        width: 220,
        height: 200,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 30,
      },
      {
        id: 'zone-3',
        x: 600,
        y: 800,
        width: 220,
        height: 200,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 30,
      },
      {
        id: 'zone-4',
        x: 850,
        y: 800,
        width: 220,
        height: 200,
        rotation: 0,
        shape: 'rectangle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 5. Big + Two Small
  {
    id: 'mock-big-two-small',
    name: 'Big + Two Small',
    description: 'One large photo with two smaller ones below',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 100,
        y: 100,
        width: 1000,
        height: 1000,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: 50,
      },
      {
        id: 'zone-2',
        x: 100,
        y: 1150,
        width: 475,
        height: 550,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
      },
      {
        id: 'zone-3',
        x: 625,
        y: 1150,
        width: 475,
        height: 550,
        rotation: 0,
        shape: 'rectangle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 6. Instagram Grid (3x3)
  {
    id: 'mock-instagram-grid',
    name: 'Instagram Grid',
    description: 'Classic 3x3 Instagram layout',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 100,
        y: 100,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
        margin_bottom: 50,
      },
      {
        id: 'zone-2',
        x: 450,
        y: 100,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
        margin_bottom: 50,
      },
      {
        id: 'zone-3',
        x: 800,
        y: 100,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: 50,
      },
      {
        id: 'zone-4',
        x: 100,
        y: 650,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
        margin_bottom: 50,
      },
      {
        id: 'zone-5',
        x: 450,
        y: 650,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
        margin_bottom: 50,
      },
      {
        id: 'zone-6',
        x: 800,
        y: 650,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: 50,
      },
      {
        id: 'zone-7',
        x: 100,
        y: 1200,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
      },
      {
        id: 'zone-8',
        x: 450,
        y: 1200,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
      },
      {
        id: 'zone-9',
        x: 800,
        y: 1200,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 7. Triangular Layout
  {
    id: 'mock-triangle',
    name: 'Triangle',
    description: 'Three photos in a triangular arrangement',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 500,
        y: 100,
        width: 200,
        height: 200,
        rotation: 0,
        shape: 'circle',
        margin_bottom: 100,
      },
      {
        id: 'zone-2',
        x: 200,
        y: 400,
        width: 300,
        height: 300,
        rotation: 0,
        shape: 'circle',
        margin_right: 100,
      },
      {
        id: 'zone-3',
        x: 600,
        y: 400,
        width: 300,
        height: 300,
        rotation: 0,
        shape: 'circle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 8. Polaroid Style
  {
    id: 'mock-polaroid',
    name: 'Polaroid Style',
    description: 'Classic polaroid with white border',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 200,
        y: 200,
        width: 800,
        height: 800,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: 100,
      },
      {
        id: 'zone-2',
        x: 300,
        y: 1100,
        width: 600,
        height: 600,
        rotation: 0,
        shape: 'rectangle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 9. Rounded Squares Grid
  {
    id: 'mock-rounded-grid',
    name: 'Rounded Squares',
    description: '2x2 grid with rounded corners',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 100,
        y: 250,
        width: 475,
        height: 475,
        rotation: 0,
        shape: 'rounded_rect',
        margin_right: 50,
        margin_bottom: 50,
      },
      {
        id: 'zone-2',
        x: 625,
        y: 250,
        width: 475,
        height: 475,
        rotation: 0,
        shape: 'rounded_rect',
        margin_bottom: 50,
      },
      {
        id: 'zone-3',
        x: 100,
        y: 775,
        width: 475,
        height: 475,
        rotation: 0,
        shape: 'rounded_rect',
        margin_right: 50,
      },
      {
        id: 'zone-4',
        x: 625,
        y: 775,
        width: 475,
        height: 475,
        rotation: 0,
        shape: 'rounded_rect',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },

  // 10. Magazine Layout
  {
    id: 'mock-magazine',
    name: 'Magazine Layout',
    description: 'Editorial magazine-style layout',
    width: 1200,
    height: 1800,
    zones: [
      {
        id: 'zone-1',
        x: 100,
        y: 100,
        width: 400,
        height: 600,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
        margin_bottom: 50,
      },
      {
        id: 'zone-2',
        x: 550,
        y: 100,
        width: 550,
        height: 350,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: 50,
      },
      {
        id: 'zone-3',
        x: 550,
        y: 500,
        width: 550,
        height: 200,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: 100,
      },
      {
        id: 'zone-4',
        x: 100,
        y: 750,
        width: 1000,
        height: 400,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: 50,
      },
      {
        id: 'zone-5',
        x: 100,
        y: 1200,
        width: 650,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
        margin_right: 50,
      },
      {
        id: 'zone-6',
        x: 800,
        y: 1200,
        width: 300,
        height: 500,
        rotation: 0,
        shape: 'rectangle',
      }
    ],
    is_default: false,
    created_at: new Date().toISOString(),
  },
];

// Helper function to get a random mock frame
export function getRandomMockFrame(): Frame {
  const randomIndex = Math.floor(Math.random() * mockFrames.length);
  return mockFrames[randomIndex];
}

// Helper function to get mock frames by name pattern
export function getMockFramesByPattern(pattern: string): Frame[] {
  const lowerPattern = pattern.toLowerCase();
  return mockFrames.filter(frame =>
    frame.name.toLowerCase().includes(lowerPattern) ||
    frame.description.toLowerCase().includes(lowerPattern)
  );
}
