import React from 'react';
import { ZoneCorners, SelectionRectangle } from '../types';
import { formatLambert93, formatWgs84 } from '../utils/coordinateTransform';

interface CoordinateDisplayProps {
  corners: ZoneCorners;
  rectangle: SelectionRectangle | null;
  onClear: () => void;
  onDownload: () => void;
}

export const CoordinateDisplay: React.FC<CoordinateDisplayProps> = ({
  corners,
  rectangle,
  onClear,
  onDownload,
}) => {
  const hasSelection = rectangle !== null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white shadow-lg rounded-tr-lg rounded-tl-lg border-t border-gray-300">
      <div className="p-4 max-h-80 overflow-y-auto">
        {hasSelection ? (
          <div className="space-y-4">
            <h3 className="font-bold text-gray-800">Selected Zone</h3>

            {/* First Corner */}
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                First Corner (Top-Left)
              </h4>
              {corners.firstCorner && corners.firstCornerL93 && (
                <div className="space-y-1">
                  <div className="text-xs text-gray-700">
                    <span className="font-medium">WGS84:</span> {formatWgs84(corners.firstCorner)}
                  </div>
                  <div className="text-xs text-gray-700">
                    <span className="font-medium">LAMBERT-93:</span> {formatLambert93(corners.firstCornerL93)}
                  </div>
                </div>
              )}
            </div>

            {/* Second Corner */}
            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                Second Corner (Bottom-Right)
              </h4>
              {corners.secondCorner && corners.secondCornerL93 && (
                <div className="space-y-1">
                  <div className="text-xs text-gray-700">
                    <span className="font-medium">WGS84:</span> {formatWgs84(corners.secondCorner)}
                  </div>
                  <div className="text-xs text-gray-700">
                    <span className="font-medium">LAMBERT-93:</span> {formatLambert93(corners.secondCornerL93)}
                  </div>
                </div>
              )}
            </div>

            {/* Rectangle Summary */}
            <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                Rectangle Bounds (LAMBERT-93)
              </h4>
              <div className="space-y-1 text-xs">
                <div className="text-gray-700">
                  <span className="font-medium">X:</span> {rectangle.topLeftL93.x.toLocaleString('fr-FR')} to{' '}
                  {rectangle.bottomRightL93.x.toLocaleString('fr-FR')}
                </div>
                <div className="text-gray-700">
                  <span className="font-medium">Y:</span> {rectangle.bottomRightL93.y.toLocaleString('fr-FR')} to{' '}
                  {rectangle.topLeftL93.y.toLocaleString('fr-FR')}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={onClear}
                className="flex-1 px-3 py-2 bg-gray-300 text-gray-800 rounded font-medium text-sm hover:bg-gray-400 transition"
              >
                Clear
              </button>
              <button
                onClick={onDownload}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 transition"
              >
                Download
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">
              Click on the map to select two corners to define a zone
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
