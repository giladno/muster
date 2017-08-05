'use strict';
import Promise from 'bluebird';
import _ from 'lodash';
import util from 'util';
import electron from 'electron';
import React, {PureComponent} from 'react';
import child_process from 'child_process';
import {Steps, Collapse} from 'antd';
import {Icon} from 'react-fa';
const execFile = Promise.promisify(child_process.execFile);

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

export default class extends PureComponent {
    state = {};

    componentDidMount(){
        this.load();
    }

    componentWillReceiveProps(nextProps){
        if (this.props.dir!=nextProps.dir)
            this.setState({checklist: undefined});
    }

    componentDidUpdate(){
        if (!this.state.checklist)
            this.load();
    }

    async load(){
        let {dir} = this.props;
        if (!dir)
            return;
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
    }

    render(){
        let {checklist} = this.state;
        if (!checklist)
            return null;
        return (
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
                </Collapse.Panel>
            </Collapse>
        );
    }
}
