import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface HighchartsChartProps {
  options: any;
  height?: number;
}

export default function HighchartsChart({ options, height = 300 }: HighchartsChartProps) {
  const chartOptions = JSON.stringify(options);

  const html = `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
        <script src="https://code.highcharts.com/highcharts.js"></script>
        <script src="https://code.highcharts.com/modules/exporting.js"></script>
        <style>
          body { margin: 0; padding: 0; background-color: transparent; }
          #container { width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <div id="container"></div>
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            Highcharts.chart('container', ${chartOptions});
          });
        </script>
      </body>
    </html>
  `;

  return (
    <View style={{ height }}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
      />
    </View>
  );
}
