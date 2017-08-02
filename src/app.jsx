'use strict';
require('./css/style.less');
import _ from 'lodash';
import Promise from 'bluebird';
import EventEmitter from 'events';
import os from 'os';
import path from 'path';
import util from 'util';
import child_process, {spawn} from 'child_process';
import readline from 'readline';
import {PassThrough} from 'stream';
import React, {PureComponent} from 'react';
import {LocaleProvider, Layout, Menu, Button, Steps, Collapse} from 'antd';
import {Icon} from 'react-fa';
import electron from 'electron';
import ReactDOM from 'react-dom';
import shortid from 'shortid';
import enUS from 'antd/lib/locale-provider/en_US';

const execFile = Promise.promisify(child_process.execFile);

const RN_CLI = 'node_modules/react-native/local-cli/cli.js';

class ConsoleStream extends EventEmitter {
    start(...args){
        return new Promise((resolve, reject)=>{
            let child = this.child = spawn(...args);
            let {pid} = child;
            electron.ipcRenderer.send('spawn', pid);
            let stream = new PassThrough();
            child.stdout.pipe(stream, {end: false});
            child.stderr.pipe(stream, {end: false});
            let rl = this.rl = readline.createInterface({input: stream});
            child.on('close', (code, signal)=>{
                electron.ipcRenderer.send('spawn', -pid);
                rl.close();
                delete this.child;
                delete this.rl;
                resolve({code, signal});
                this.emit('close', code, signal);
            }).on('error', err=>{
                reject(err);
                this.emit('error', err);
            });
            rl.on('line', data=>{
                console.log(data);
                this.emit('line', data, shortid.generate());
            });
        });
    }

    stop(signal = 'SIGINT'){
        if (this.child)
            this.child.kill(signal);
    }
}

const Url = class extends PureComponent {
    onClick = ()=>electron.shell.openExternal(this.props.url);

    render(){
        return <span>{this.props.title}<Icon
                name='info-circle'
                title={this.props.url}
                style={{cursor: 'pointer', paddingLeft: 5, color: 'lightgrey'}}
                onClick={this.onClick}
            /></span>;
    }
};

class App extends PureComponent {
    constructor(props){
        super(props);
        this.state = {
            dir: localStorage.dir,
            tab: '2',
            tabs: ['Console', 'Build', 'Packager'].map((title, key)=>({title, history: [], key})),
        };
    }

    componentDidMount(){
        let {dir} = this.state;
        document.title = dir||document.title;
        if (dir)
            this.checklist(dir);
        else
            this.open();
    }

    onTab = ({key})=>this.setState({tab: key});

    open = ()=>{
        if (this.state.streams)
            return;
        let {dialog, getCurrentWindow} = electron.remote;
        dialog.showOpenDialog(getCurrentWindow(), {properties: ['openDirectory']}, ([dir] = [])=>{
            if (!dir)
                return;
            this.setState({dir}, ()=>{
                document.title = localStorage.dir = dir;
                this.checklist(dir);
            });
        });
    };

    start = async ()=>{
        let {dir} = this.state;
        const startPackager = ()=>new Promise((resolve, reject)=>{
            let packager = new ConsoleStream();
            packager.on('close', ()=>{
                this.stop();
                resolve();
            }).on('line', (data, id)=>{
                let {tabs} = this.state;
                this.setState({tabs: [tabs[0], tabs[1],
                    {...tabs[2], history: [].concat(tabs[2].history, {data, id})}]});
                if (data.startsWith('React packager ready.'))
                    resolve(packager);
            }).on('error', reject);
            let {tabs} = this.state;
            this.setState({
                streams: {packager},
                tabs: [tabs[0], {...tabs[1], history: []}, {...tabs[2], history: []}],
            }, ()=>packager.start('node', [RN_CLI, 'start'], {cwd: dir}));
        });
        const startBuild = ()=>new Promise((resolve, reject)=>{
            let build = new ConsoleStream(), udid;
            build.on('line', (data, id)=>{
                let {tabs} = this.state;
                this.setState({tabs: [tabs[0], {...tabs[1], history: [].concat(tabs[1].history, {data, id})},
                    tabs[2]]});
                let m = data.match(/^Building using.*?-destination id=([^ ]+)/);
                if (m)
                    udid = m[1];
            }).on('error', reject);
            this.setState({streams: {...this.state.streams, build}},
                ()=>build.start('node', [RN_CLI, 'run-ios', '--no-packager'], {cwd: dir})
                .then(({code, signal})=>this.setState({streams: {...this.state.streams, build: undefined}},
                        ()=>resolve(code || signal ? null : udid)))
                .catch(reject));
        });
        const startSyslog = async udid=>{
            if (!udid)
            {
                udid = []
                    .concat(...Object.values(JSON.parse(await execFile('xcrun', ['simctl', 'list', '--json',
                        'devices'], {encoding: 'utf8'})).devices))
                    .reduce((res, {state, udid})=>res || state=='Booted' && udid, null);
            }
            return new Promise((resolve, reject)=>{
                let syslog = new ConsoleStream();
                syslog.on('line', (data, id)=>{
                    let {tabs} = this.state;
                    this.setState({tabs: [{...tabs[0], history: [].concat(tabs[0].history, {data, id})}, tabs[1],
                        tabs[2]]});
                }).on('error', reject);
                this.setState({streams: {...this.state.streams, syslog}}, ()=>{
                    syslog.start('syslog', ['-w', '-F', 'std', '-d',
                        path.join(os.homedir(), 'Library', 'Logs', 'CoreSimulator', udid, 'asl')]);
                    resolve(syslog);
                });
            });
        };
        let packager = await startPackager();
        if (!packager)
            return;
        return;
        let udid = await startBuild();
        if (!udid)
            return packager.stop();
        await startSyslog(udid);
    };

    stop = ()=>{
        let {streams} = this.state;
        if (!streams)
            return;
        for (let name in streams)
        {
            if (streams[name])
                streams[name].stop();
        }
        this.setState({streams: null});
    };

    checklist = async dir=>{
        let env = process.env;
        try {
            env = JSON.parse((await execFile('node', ['-e', 'console.log(JSON.stringify(process.env))'],
                        {encoding: 'utf8'})).trim());
        } catch(err) {}
        const shell = async opt=>{
            let {cmd, args = [], post_process, format, join = ''} = opt;
            try {
                let output = opt.env ? env[opt.env] :
                    await execFile(cmd, [].concat(args), {encoding: 'utf8', cwd: dir});
                output = output.trim();
                if (!post_process)
                    return output;
                if (typeof post_process=='function')
                    return post_process(output);
                let groups = [];
                for (let rx of [].concat(post_process))
                {
                    let m = output.match(rx);
                    if (!m)
                        return '';
                    if (m.length==1)
                        groups.push(m[0]);
                    else
                        groups.push(...m.slice(1));
                }
                if (format)
                    return util.format(format, ...groups);
                return groups.join(join);
            }
            catch(err) { return null; }
        };
        this.setState({checklist: await Promise.all([
            {title: 'Node.js', cmd: 'node', args: '-v', post_process: /[\d.]+/,
                url: 'https://facebook.github.io/react-native/docs/getting-started.html#installing-dependencies'},
            {title: 'Watchman', cmd: 'watchman', args: '-v',
                url: 'https://facebook.github.io/react-native/docs/getting-started.html#installing-dependencies'},
            {title: 'Xcode', cmd: 'xcodebuild', args: '-version',
                post_process: [/xcode ([\d.]+)/i, /version ([\w]+)/i], format: '%s (%s)',
                url: 'https://facebook.github.io/react-native/docs/getting-started.html#xcode'},
            {title: 'Command Line Tools', description: {finish: 'Installed', error: 'Not Installed'},
                cmd: 'xcode-select', args: '-p',
                url: 'https://facebook.github.io/react-native/docs/getting-started.html#command-line-tools'},
            {title: 'ANDROID_HOME', env: 'ANDROID_HOME', url: 'https://facebook.github.io/react-native/docs/'+
                'getting-started.html#3-configure-the-android-home-environment-variable'},
            {title: 'ADB', cmd: 'adb', args: 'version', post_process: /version ([\d.]+)/,
                url: 'https://facebook.github.io/react-native/docs/getting-started.html#'+
                'android-development-environment'},
        ].map(async opt=>{
            let data = {...opt, output: await shell(opt)};
            data.status = data.status ? _.template(data.status)(data) : data.output ? 'finish' : 'error';
            for (let key of ['title', 'description'])
            {
                let text = data[key];
                if (typeof text=='object')
                    text = text[data.status];
                if (!text)
                {
                    if (key=='description')
                        data.description = data.output || 'Unknown';
                    continue;
                }
                data[key] = _.template(text)(data);
            }
            if (data.url)
                data.title = (<Url {...data} />);
            return data;
        }))});
    };

    render(){
        let {dir, tab, tabs, streams, checklist} = this.state;
        return (
            <LocaleProvider locale={enUS}>
                <Layout>
                    <Layout.Sider id='menu' width={200}>
                        <div id='toolbar'>
                            <Button
                                size='small'
                                disabled={streams ? 'disabled' : false}
                                onClick={this.open}
                                title='Load Project'
                            ><Icon name='folder-o' /></Button>
                            <Button.Group style={{float: 'right'}}>
                                <Button
                                    size='small'
                                    disabled={dir && !streams ? false : 'disabled'}
                                    onClick={this.start}
                                    title='Debug'
                                ><Icon name='play' /></Button>
                                <Button
                                    size='small'
                                    disabled={streams ? false : 'disabled'}
                                    onClick={this.stop}
                                    title='Stop'
                                ><Icon name='stop' /></Button>
                            </Button.Group>
                        </div>
                        <Menu onSelect={this.onTab} selectedKeys={[tab]} mode='inline' style={{border: 0}}>
                            <Menu.Divider />
                            {tabs.map(({title, key})=><Menu.Item key={key}>{title}</Menu.Item>)}
                        </Menu>
                    </Layout.Sider>
                    <Layout.Content style={{marginLeft: 200}} id='console'>
                        {tabs[+tab].history.map(({id, data})=>(<div key={id}>{data}</div>))}
                    </Layout.Content>
                    {checklist && <Layout.Sider id='checklist'>
                        <Collapse bordered={false} defaultActiveKey='checklist'>
                            <Collapse.Panel header='Checklist' key='checklist'>
                                <Steps direction='vertical' size='small'>
                                    {checklist.map(({cmd, env, title, description, status})=><Steps.Step
                                        key={env||cmd}
                                        status={status}
                                        title={title}
                                        description={description}
                                    />)}
                                </Steps>
                        </Collapse.Panel></Collapse>
                    </Layout.Sider>}
                </Layout>
            </LocaleProvider>
        );
    }
}

ReactDOM.render(<App />, document.getElementById('root'));
