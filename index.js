'use strict';
const path = require('path');
const url = require('url');
const {app, Menu, Tray, BrowserWindow, ipcMain} = require('electron');

let tray, win, server, pids = new Set();

app.on('ready', async ()=>{
    if (process.env.NODE_ENV=='development')
    {
        const webpack = require('webpack');
        const WebpackDevServer = require('webpack-dev-server');
        const config = require('./webpack.config');

        server = new WebpackDevServer(webpack(config), {publicPath: config.output.publicPath});
        await new Promise((resolve, reject)=>server.listen(3000, err=>{
            if (err)
                return reject(err);
            resolve();
        }));

        ipcMain.on('spawn', (event, pid)=>{
            if (pid>0)
                pids.add(pid);
            else
                pids.delete(-pid);
        });
    }
    tray = new Tray('./tray.png');
    tray.setToolTip('Muster');
    tray.setContextMenu(Menu.buildFromTemplate([
        {label: 'Show', click: create_window},
        {type: 'separator'},
        {label: 'Quit Muster', click: ()=>{
            app.quiting = true;
            app.quit();
        }},
    ]));
    create_window();
});

const create_window = ()=>{
    if (win)
        return win.show();
    win = new BrowserWindow({width: 1024, height: 768});
    if (process.env.NODE_ENV=='development')
    {
        win.webContents.on('dom-ready', ()=>{
            for (let pid of pids)
                process.kill(pid);
            pids.clear();
        });
        win.loadURL('http://localhost:3000/client/');
        win.webContents.openDevTools();
    }
    else
    {
        win.loadURL(url.format({pathname: path.join(__dirname, 'client', 'index.html'), protocol: 'file:',
            slashes: true}));
        win.on('close', event=>{
            if (app.quiting)
                return false;
            event.preventDefault();
            win.hide();
            app.dock.hide();
        });
    }
    win.on('show', ()=>app.dock.show());
    win.on('closed', ()=>win = null);
};

