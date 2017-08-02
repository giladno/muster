'use strict';
const path = require('path');
const webpack = require('webpack');
const config = require('./package.json');

module.exports = require('webpack-merge')({
    target: 'electron-renderer',
    entry: ['babel-polyfill'],
    output: {
        path: path.join(__dirname, 'client'),
        filename: 'bundle.js',
    },
    module: {
        loaders: [{
            test: /\.jsx?$/,
            exclude: /node_modules/,
            loaders: ['babel-loader'],
            include: path.join(__dirname, 'src'),
        }, {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
        }, {
            test: /\.less$/,
            use: ['style-loader', 'css-loader', {loader: 'less-loader', query: {modifyVars: config.theme||{}}}],
        }, {
            test: /\.(jpe?g|png|woff|woff2|eot|ttf|svg)$/,
            loader: 'url-loader?limit=100000',
        }],
    },
    plugins: [
        new (require('html-webpack-plugin'))({
            inject: false,
            template: require('html-webpack-template'),
            title: config.productName,
            appMountId: 'root',
            minify: {collapseWhitespace: true},
            mobile: false,
        }),
    ],
}, {
    development: {
        devtool: 'cheap-module-eval-source-map',
        output: {
            publicPath: '/client/',
        },
        entry: [
            'webpack-dev-server/client?http://localhost:3000',
            './src/app.jsx',
        ],
        plugins: [
            new webpack.DefinePlugin({'process.env.NODE_ENV': JSON.stringify('development')}),
        ],
    },
    production: {
        entry: [
            './src/app.jsx',
        ],
        plugins: [
            new webpack.DefinePlugin({'process.env.NODE_ENV': JSON.stringify('production')}),
            new webpack.optimize.UglifyJsPlugin({
                comments: false,
                compress: {
                    warnings: false,
                    dead_code: true,
                    properties: true,
                    conditionals: true,
                    booleans: true,
                    loops: true,
                    unused: true,
                    if_return: true,
                    negate_iife: true,
                    drop_console: true,
                    passes: 2,
                },
            }),
        ],
    },
}[process.env.NODE_ENV=='development' && process.env.NODE_ENV || 'production']);
