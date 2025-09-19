// webpack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');

// Make config env-aware so dev and prod each get the right publicPath.
module.exports = (_env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.js',

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isDev ? 'index_bundle.js' : 'index_bundle.[contenthash].js',
      // Dev needs absolute '/' so webpack-dev-server serves the in-memory index.html at /
      // Prod needs './' so assets work from a subpath like /Black-Ops-Demo/ on GitHub Pages.
      publicPath: isDev ? '/' : './',
      clean: true,
    },

    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, './src/index.html'),
        scriptLoading: 'defer',
      }),
      new CopyPlugin({
        patterns: [
          // copy everything in /static into the dist root
          { from: path.resolve(__dirname, 'static'), to: '.' },
        ],
      }),
    ],

    // During dev, only serve /static so the page always comes from HtmlWebpackPlugin (in-memory).
    devServer: {
      static: [ path.resolve(__dirname, 'static') ],
      compress: true,
      port: 5173,
      hot: true,
      historyApiFallback: true,
    },

    performance: { hints: false },
  };
};