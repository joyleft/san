/**
 * san-vm
 * Copyright 2016 Baidu Inc. All rights reserved.
 *
 * @file vm引擎
 * @author errorrik(errorrik@gmail.com)
 */


(function (root) {

    // #region utils
    /**
     * 对象属性拷贝
     *
     * @inner
     * @param {Object} target 目标对象
     * @param {Object} source 源对象
     * @return {Object} 返回目标对象
     */
    function extend(target, source) {
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                target[key] = source[key];
            }
        }

        return target;
    }

    /**
     * 构建类之间的继承关系
     *
     * @inner
     * @param {Function} subClass 子类函数
     * @param {Function} superClass 父类函数
     */
    function inherits(subClass, superClass) {
        /* jshint -W054 */
        var subClassProto = subClass.prototype;
        var F = new Function();
        F.prototype = superClass.prototype;
        subClass.prototype = new F();
        subClass.prototype.constructor = subClass;
        extend(subClass.prototype, subClassProto);
        /* jshint +W054 */
    }

    /**
     * 遍历数组集合
     *
     * @inner
     * @param {Array} source 数组源
     * @param {function(*,Number):boolean} iterator 遍历函数
     */
    function each(array, iterator) {
        if (array && array.length > 0) {
            for (var i = 0, l = array.length; i < l; i++) {
                iterator.call(array, array[i], i);
            }
        }
    }

    /**
     * Function.prototype.bind 方法的兼容性封装
     *
     * @inner
     * @param {Function} func 要bind的函数
     * @param {Object} thisArg this指向对象
     * @param {...*} args 预设的初始参数
     * @return {Function}
     */
    function bind(func, thisArg) {
        var nativeBind = Function.prototype.bind;
        var slice = Array.prototype.slice;
        if (nativeBind && func.bind === nativeBind) {
            return nativeBind.apply(func, slice.call(arguments, 1));
        }

        var args = slice.call(arguments, 2);
        return function () {
            func.apply(thisArg, args.concat(slice.call(arguments)));
        };
    }

    /**
     * DOM 事件挂载
     *
     * @inner
     * @param {HTMLElement} el
     * @param {string} eventName
     * @param {Function} listener
     */
    function on(el, eventName, listener) {
        if (el.addEventListener) {
            el.addEventListener(eventName, listener, false);
        }
        else {
            el.attachEvent('on' + eventName, listener);
        }
    }

    /**
     * DOM 事件卸载
     *
     * @inner
     * @param {HTMLElement} el
     * @param {string} eventName
     * @param {Function} listener
     */
    function un(el, eventName, listener) {
        if (el.addEventListener) {
            el.removeEventListener(eventName, listener, false);
        }
        else {
            el.detachEvent('on' + eventName, listener);
        }
    }

    /**
     * 唯一id的起始值
     *
     * @inner
     * @type {number}
     */
    var guidIndex = 1;

    /**
     * 获取唯一id
     *
     * @inner
     * @return {string} 唯一id
     */
    function guid() {
        return '_san-vm_' + (guidIndex++);
    }

    /**
     * 下一个周期要执行的任务列表
     *
     * @inner
     * @type {Array}
     */
    var nextTasks = [];

    /**
     * 执行下一个周期任务的函数
     *
     * @inner
     * @type {Function}
     */
    var nextHandler;

    /**
     * 在下一个时间周期运行任务
     *
     * @inner
     * @param {Function} 要运行的任务函数
     */
    function nextTick(func) {
        nextTasks.push(func);

        if (nextHandler) {
            return;
        }

        nextHandler = function () {
            var tasks = nextTasks.slice(0);
            nextTasks = [];
            nextHandler = null;

            for (var i = 0, l = tasks.length; i < l; i++) {
                tasks[i]();
            }
        };

        if (typeof MutationObserver === 'function') {
            var num = 1;
            var observer = new MutationObserver(nextHandler);
            var text = document.createTextNode(num);
            observer.observe(text, {
                characterData: true
            });
            text.data = ++num;
        }
        else if (typeof setImmediate === 'function') {
            setImmediate(nextHandler);
        }
        else {
            setTimeout(nextHandler, 0);
        }
    }

    /**
     * 字符串连接时是否使用老式的兼容方案
     *
     * @inner
     * @type {boolean}
     */
    var compatStringJoin = (function () {
        var ieVersionMatch = typeof navigator !== 'undefined'
            && navigator.userAgent.match(/msie\s*([0-9]+)/i);

        return ieVersionMatch && ieVersionMatch[1] - 0 < 8;
    })();

    /**
     * 写个用于跨平台提高性能的字符串连接类
     * 万一不小心支持老式浏览器了呢
     *
     * @inner
     * @class
     */
    function StringBuffer() {
        this.raw = compatStringJoin ? [] : '';
    }

    /**
     * 获取连接的字符串结果
     *
     * @inner
     * @return {string}
     */
    StringBuffer.prototype.toString = function () {
        return compatStringJoin ? this.raw.join('') : this.raw;
    };

    /**
     * 增加字符串片段
     * 就不支持多参数，别问我为什么，这东西也不是给外部用的
     *
     * @inner
     * @param {string} source 字符串片段
     */
    StringBuffer.prototype.push = compatStringJoin
        ? function (source) {
            this.raw.push(source);
        }
        : function (source) {
            this.raw += source;
        };

    /**
     * 索引列表，能根据 item 中的 name 进行索引
     *
     * @inner
     * @class
     */
    function IndexedList() {
        this.raw = [];
        this.index = {};
    }

    /**
     * 在列表末尾添加 item
     *
     * @inner
     * @param {Object} item 要添加的对象
     */
    IndexedList.prototype.push = function (item) {
        if (!item.name) {
            throw new Error('Object must have "name" property');
        }

        if (!this.index[item.name]) {
            this.raw.push(item);
            this.index[item.name] = item;
        }
    };

    /**
     * 根据顺序下标获取 item
     *
     * @inner
     * @param {number} index 顺序下标
     * @return {Object}
     */
    IndexedList.prototype.getAt = function (index) {
        return this.raw[index];
    };

    /**
     * 根据 name 获取 item
     *
     * @inner
     * @param {string} name name
     * @return {Object}
     */
    IndexedList.prototype.get = function (name) {
        return this.index[name];
    };

    /**
     * 遍历 items
     *
     * @inner
     * @param {function(*,Number):boolean} iterator 遍历函数
     * @param {Object} context 遍历函数运行的this环境
     */
    IndexedList.prototype.each = function (iterator, context) {
        each(this.raw, bind(iterator, context || this));
    };

    /**
     * 根据顺序下标移除 item
     *
     * @inner
     * @param {number} index 顺序
     */
    IndexedList.prototype.removeAt = function (index) {
        var name = this.raw[index].name;
        delete this.index[name];
        this.raw.splice(index, 1);
    };

    /**
     * 根据 name 移除 item
     *
     * @inner
     * @param {string} name name
     */
    IndexedList.prototype.remove = function (name) {
        delete this.index[name];

        var len = this.raw.length;
        while (len--) {
            if (this.raw[len].name === name) {
                this.raw.splice(len, 1);
                break;
            }
        }
    };

    /**
     * 判断标签是否应自关闭
     *
     * @inner
     * @param {string} tagName 标签名
     * @return {boolean}
     */
    function tagIsAutoClose(tagName) {
        return /^(img|input)$/i.test(tagName)
    }

    // #region parse
    /**
     * 表达式类型
     *
     * @inner
     * @const
     * @type {Object}
     */
    var ExprType = {
        STRING: 1,
        NUMBER: 2,
        IDENT: 3,
        PROP_ACCESSOR: 4,
        INTERPOLATION: 5,
        CALL: 6,
        TEXT: 7
    };

    /**
     * 字符串源码读取类，用于模板字符串解析过程
     *
     * @inner
     * @class
     * @param {string} source 要读取的字符串
     */
    function Walker(source) {
        this.source = source;
        this.len = this.source.length;
        this.index = 0;
    }

    /**
     * 获取当前字符码
     *
     * @return {number}
     */
    Walker.prototype.currentCode = function () {
        return this.charCode(this.index);
    };

    /**
     * 获取当前读取位置
     *
     * @return {number}
     */
    Walker.prototype.currentIndex = function () {
        return this.index;
    };

    /**
     * 截取字符串片段
     *
     * @param {number} start 起始位置
     * @param {number} end 结束位置
     * @return {string}
     */
    Walker.prototype.cut = function (start, end) {
        return this.source.slice(start, end);
    };

    /**
     * 向前读取字符
     *
     * @param {number} distance 读取字符数
     */
    Walker.prototype.go = function (distance) {
        this.index += distance;
    };

    /**
     * 读取下一个字符，返回下一个字符的 code
     *
     * @return {number}
     */
    Walker.prototype.nextCode = function () {
        this.go(1);
        return this.currentCode();
    };

    /**
     * 获取相应位置字符的 code
     *
     * @return {number}
     */
    Walker.prototype.charCode = function (index) {
        return this.source.charCodeAt(index);
    };

    /**
     * 向前读取字符，直到遇到指定字符再停止
     *
     * @param {number} charCode 指定字符的code
     */
    Walker.prototype.goUtil = function (charCode) {
        var code;
        while ((code = this.currentCode())) {
            if (code === 32 || code === 9) {
                this.index++;
            }
            else {
                if (code === charCode) {
                    this.index++;
                    return true;
                }
                return false;
            }
        }
    };

    /**
     * 向前读取符合规则的字符片段，并返回规则匹配结果
     *
     * @param {RegExp} reg 字符片段的正则表达式
     * @return {Array}
     */
    Walker.prototype.match = function (reg) {
        reg.lastIndex = this.index;

        var match = reg.exec(this.source);
        if (match) {
            this.index = reg.lastIndex;
        }

        return match;
    };

    /**
     * 模板解析生成的抽象节点
     *
     * @class
     * @inner
     * @param {Object=} options 节点参数
     * @param {stirng=} options.tagName 标签名
     * @param {ANode=} options.parent 父节点
     * @param {boolean=} options.isText 是否文本节点
     */
    function ANode(options) {
        extend(this, options);

        this.directives = new IndexedList();
        this.binds = new IndexedList();
        this.events = new IndexedList();
        this.childs = [];
    }

    /**
     * 解析 template
     *
     * @inner
     * @param {string} source template 源码
     * @return {node.Root}
     */
    function parseTemplate(source) {
        var rootNode = new ANode();

        if (typeof source !== 'string') {
            return rootNode;
        }

        source = source.replace(/<!--([\s\S]*?)-->/mg, '');
        var walker = new Walker(source);

        var tagReg = /<(\/)?([a-z0-9-]+)\s*/ig;
        var attrReg = /([-:0-9a-z\(\)\[\]]+)(=(['"])([^\3]+?)\3)?\s*/ig;

        var tagMatch;
        var currentNode = rootNode;
        var beforeLastIndex = 0;

        while ((tagMatch = walker.match(tagReg)) != null) {
            var tagEnd = tagMatch[1];
            var tagName = tagMatch[2].toLowerCase();

            pushTextNode(source.slice(
                beforeLastIndex,
                walker.currentIndex() - tagMatch[0].length
            ));

            // 62: >
            // 47: /
            if (tagEnd && walker.currentCode() === 62) {
                // 满足关闭标签的条件时，关闭标签
                // 向上查找到对应标签，找不到时忽略关闭
                var closeTargetNode = currentNode;
                while (closeTargetNode && closeTargetNode.tagName !== tagName) {
                    closeTargetNode = closeTargetNode.parent;
                }

                closeTargetNode && (currentNode = closeTargetNode.parent);
                walker.go(1);
            }
            else if (!tagEnd) {
                var aElement = new ANode({
                    tagName: tagName,
                    parent: currentNode
                });
                var tagClose = tagIsAutoClose(tagName);

                // 解析 attributes
                while (1) {
                    var nextCharCode = walker.currentCode();

                    // 标签结束时跳出 attributes 读取
                    // 标签可能直接结束或闭合结束
                    if (nextCharCode === 62) {
                        walker.go(1);
                        break;
                    }
                    else if (nextCharCode === 47
                        && walker.charCode(walker.currentIndex() + 1) === 62
                    ) {
                        walker.go(2);
                        tagClose = true;
                        break;
                    }

                    // 读取 attribute
                    var attrMatch = walker.match(attrReg);
                    if (attrMatch) {
                        integrateAttr(
                            aElement,
                            attrMatch[1],
                            attrMatch[2] ? attrMatch[4] : ''
                        );
                    }
                }

                currentNode.childs.push(aElement);
                if (!tagClose) {
                    currentNode = aElement;
                }
            }

            beforeLastIndex = walker.currentIndex();
        }

        pushTextNode(walker.cut(beforeLastIndex));

        return rootNode;

        /**
         * 在读取栈中添加文本节点
         *
         * @inner
         * @param {string} 文本内容
         */
        function pushTextNode(text) {
            if (text) {
                currentNode.childs.push(new ANode({
                    isText: true,
                    text: text,
                    parent: currentNode
                }));
            }
        }

        /**
         * 解析抽象节点属性
         *
         * @inner
         * @param {ANode} aElement 抽象节点
         * @param {string} name 属性名称
         * @param {string} value 属性值
         */
        function integrateAttr(aElement, name, value) {
            var prefixIndex = name.indexOf('-');
            var prefix;
            var realName;

            if (name === 'id') {
                aElement.id = value;
            }

            if (prefixIndex > 0) {
                prefix = name.slice(0, prefixIndex);
                realName = name.slice(prefixIndex + 1);
            }

            switch (prefix) {
                case 'on':
                    aElement.events.push({
                        name: realName,
                        expr: parseCall(value)
                    });
                    break;

                case 'bind':
                    var twoWay = false;
                    if (realName.indexOf('-') === 0) {
                        realName = realName.slice(1);
                        twoWay = true;
                    }
                    aElement.binds.push({
                        name: realName,
                        expr: parseExpr(value),
                        twoWay: twoWay
                    });
                    break;

                case 'san':
                    aElement.directives.push(parseDirective(realName, value));
                    break;

                default:
                    aElement.binds.push({
                        name: name,
                        expr: parseText(value)
                    });
            }
        }
    }

    /**
     * 指令解析器
     *
     * @type {Object}
     * @inner
     */
    var directiveParsers = {
        'for': function (value) {
            var walker = new Walker(value);
            var match = walker.match(/^\s*([\$0-9a-z_]+)(\s*,\s*([\$0-9a-z_]+))?\s+in\s+/ig);

            if (match) {
                return {
                    item: match[1],
                    index: match[3],
                    list: readExpr(walker)
                }
            }

            throw new Error('for syntax error: ' + value);
        }
    };

    /**
     * 解析指令
     *
     * @inner
     * @param {string} name 指令名称
     * @param {string} value 指令值
     * @return {Object=}
     */
    function parseDirective(name, value) {
        var parser = directiveParsers[name];
        if (parser) {
            var result = parser(value);
            result.name = name;
            return result;
        }

        return null;
    }

    /**
     * 解析文本
     *
     * @inner
     * @param {string} source 源码
     * @return {Object}
     */
    function parseText(source) {
        var exprStartReg = /\{\{\s*([\s\S]+?)\s*\}\}/ig;
        var exprMatch;

        var walker = new Walker(source);
        var segs = [];
        var beforeIndex = 0;
        while ((exprMatch = walker.match(exprStartReg)) != null) {
            var beforeText = walker.cut(
                beforeIndex,
                walker.currentIndex() - exprMatch[0].length
            );

            beforeText && segs.push({
                type: ExprType.STRING,
                value: beforeText
            });
            segs.push(parseInterpolation(exprMatch[1]));
            beforeIndex = walker.currentIndex();
        }

        var tail = walker.cut(beforeIndex);
        tail && segs.push({
            type: ExprType.STRING,
            value: tail
        });

        return {
            type: ExprType.TEXT,
            segs: segs
        };
    }

    /**
     * 解析差值替换
     *
     * @inner
     * @param {string} source 源码
     * @return {Object}
     */
    function parseInterpolation(source) {
        var walker = new Walker(source);
        var expr = readExpr(walker);

        var filters = [];
        while (walker.goUtil(124)) { // |
            filters.push(readCall(walker));
        }

        return {
            type: ExprType.INTERPOLATION,
            expr: expr,
            filters: filters
        };
    }

    /**
     * 解析表达式
     *
     * @inner
     * @param {string} source 源码
     * @return {Object}
     */
    function parseExpr(source) {
        return readExpr(new Walker(source));
    }

    /**
     * 解析调用
     *
     * @inner
     * @param {string} source 源码
     * @return {Object}
     */
    function parseCall(source) {
        return readCall(new Walker(source));
    }

    /**
     * 读取字符串
     *
     * @inner
     * @param {Walker} walker 源码读取对象
     * @return {Object}
     */
    function readString(walker) {
        var startCode = walker.currentCode();
        var startIndex = walker.currentIndex();
        var char;

        walkLoop: while ((charCode = walker.nextCode())) {
            switch (charCode) {
                case 92: // \
                    walker.go(1);
                    break;
                case startCode:
                    walker.go(1);
                    break walkLoop;
            }
        }

        return {
            type: ExprType.STRING,
            literal: walker.cut(startIndex, walker.currentIndex())
        };
    }

    /**
     * 读取ident
     *
     * @inner
     * @param {Walker} walker 源码读取对象
     * @return {Object}
     */
    function readIdentifier(walker) {
        var match = walker.match(/\s*([\$0-9a-z_]+)/ig);
        return {
            type: ExprType.IDENT,
            name: match[1]
        };
    }

    /**
     * 读取数字
     *
     * @inner
     * @param {Walker} walker 源码读取对象
     * @return {Object}
     */
    function readNumber(walker) {
        var match = walker.match(/\s*(-?[0-9]+(.[0-9]+)?)/g);

        return {
            type: ExprType.NUMBER,
            literal: match[1]
        };
    }

    /**
     * 读取属性访问表达式
     *
     * @inner
     * @param {Walker} walker 源码读取对象
     * @return {Object}
     */
    function readPropertyAccessor(walker) {
        var result = {
            type: ExprType.PROP_ACCESSOR,
            paths: []
        };

        var firstSeg = readIdentifier(walker);
        if (!firstSeg) {
            return null;
        }

        result.paths.push(firstSeg);
        accessorLoop: while (1) {
            var code = walker.currentCode();

            switch (code) {
                case 46: // .
                    walker.go(1);
                    result.paths.push(readIdentifier(walker));
                    break;

                case 91: // [
                    walker.go(1);
                    result.paths.push(readExpr(walker));
                    walker.goUtil(93);  // ]

                default:
                    break accessorLoop;
            }
        }

        if (result.paths.length === 1) {
            return firstSeg;
        }

        return result;
    }

    /**
     * 读取表达式
     *
     * @inner
     * @param {Walker} walker 源码读取对象
     * @return {Object}
     */
    function readExpr(walker) {
        walker.goUtil();
        var code = walker.currentCode();
        switch (code) {
            case 34: // "
            case 39: // '
                return readString(walker);
            case 45:
            case 48:
            case 49:
            case 50:
            case 51:
            case 52:
            case 53:
            case 54:
            case 55:
            case 56:
            case 57:
                return readNumber(walker);
            default:
                return readPropertyAccessor(walker);
        }
    }

    /**
     * 读取调用
     *
     * @inner
     * @param {Walker} walker 源码读取对象
     * @return {Object}
     */
    function readCall(walker) {
        walker.goUtil();
        var identifier = readIdentifier(walker);
        var args = [];

        if (walker.goUtil(40)) { // (
            while (!walker.goUtil(41)) { // )
                args.push(readExpr(walker));
                walker.goUtil(44); // ,
            }
        }

        return {
            type: ExprType.CALL,
            name: identifier,
            args: args
        };
    }

    // #region Model

    /**
     * 数据容器类
     *
     * @inner
     * @class
     */
    function Model() {
        this.listeners = [];
        this.data = {};
    }

    /**
     * 添加数据变更的事件监听器
     *
     * @param {Function} listener 监听函数
     * @param {string|Object} expr 数据项表达式
     */
    Model.prototype.onChange = function (listener, expr) {
        this.listeners.push({expr: expr, fn: listener});
    };

    /**
     * 移除数据变更的事件监听器
     *
     * @param {Function} listener 监听函数
     * @param {string|Object} expr 数据项表达式
     */
    Model.prototype.unChange = function (listener, expr) {
        var len = this.listeners.length;
        while (len--) {
            var item = this.listeners[len];
            // TODO: 这个逻辑要重新梳理下，看listener和expr哪个允许为空
            if (item.expr === expr && (!listener || listener === item.fn)) {
                this.listeners.splice(len, 1);
            }
        }
    };

    /**
     * 触发数据变更
     *
     * @param {Object} change 变更信息对象
     */
    Model.prototype.fireChange = function (change) {

        for (var i = 0; i < this.listeners.length; i++) {
            var listenItem = this.listeners[i];

            if (this.isItemChange(listenItem.expr, change.expr)) {
                listenItem.fn.call(this, change);
            }
        }
    };

    /**
     * 判断监听表达式是否变更
     *
     * @desc 比如监听person的变更，实际变更表达式为person.name，也认为发生了改变
     * @param {Object} listenExpr 监听表达式
     * @param {Object} changeExpr 变更表达式
     * @return {boolean}
     */
    Model.prototype.isItemChange = function (listenExpr, changeExpr) {
        var listenSegs = listenExpr.paths;
        var changeSegs = changeExpr.paths;
        if (listenExpr.type !== ExprType.PROP_ACCESSOR) {
            listenSegs = [listenExpr];
        }
        if (changeExpr.type !== ExprType.PROP_ACCESSOR) {
            changeSegs = [changeExpr];
        }

        var listenLen = listenSegs.length;
        var changeLen = changeSegs.length;
        for (var i = 0; i < changeLen; i++) {
            if (i >= listenLen) {
                return true;
            }

            var changeSeg = changeSegs[i];
            var listenSeg = listenSegs[i];

            if (listenSeg.type === ExprType.PROP_ACCESSOR) {
                return true;
            }

            if (accessorItemValue(listenSeg, this) != accessorItemValue(changeSeg, this)) {
                return false;
            }
        }

        return true;
    };

    /**
     * 获取数据项
     *
     * @param {string|Object} expr 数据项路径
     * @return {*}
     */
    Model.prototype.get = function (expr) {
        if (typeof expr === 'string') {
            expr = parseExpr(expr);
        }

        switch (expr.type) {
            case ExprType.IDENT:
                return this.data[expr.name];

            case ExprType.PROP_ACCESSOR:
                var paths = expr.paths;
                var value = this.data[paths[0].name];

                for (var i = 1, l = paths.length; value && i < l; i++) {
                    var path = paths[i];
                    var pathValue = accessorItemValue(path, this);

                    value = value[pathValue];
                }

                return value;
        }

        return null;
    };

    /**
     * 设置数据项
     *
     * @param {string|Object} expr 数据项路径
     * @param {*} value 数据值
     * @param {Object=} option 设置参数
     * @param {boolean} option.silence 静默设置，不触发变更事件
     */
    Model.prototype.set = function (expr, value, option) {
        option = option || {};
        if (typeof expr === 'string') {
            expr = parseExpr(expr);
        }

        var data = this.data;
        var changeExpr = expr;
        var prop;

        switch (expr.type) {
            case ExprType.IDENT:
                prop = expr.name;
                break;

            case ExprType.PROP_ACCESSOR:
                var pathValues = [];
                var paths = expr.paths;
                for (var i = 0, l = paths.length; i < l - 1; i++) {
                    var path = paths[i];
                    var pathValue = accessorItemValue(path, this);
                    pathValues.push(pathValue);

                    data = data[pathValue];
                    if (!data) {
                        data = data[pathValue] = {};
                    }
                }

                prop = accessorItemValue(paths[i], this);
                changeExpr = parseExpr(pathValues.join('.'));
        }

        if (prop && data[prop] !== value) {
            data[prop] = value;
            !option.silence && this.fireChange({
                expr: changeExpr
            });
        }
    };

    /**
     * 获取property accessor单项对应的名称值
     *
     * @inner
     * @param {Object} expr 单项的表达式
     * @param {Model} model 数据对象
     * @return {string}
     */
    function accessorItemValue(expr, model) {
        return expr.type === ExprType.IDENT
            ? expr.name
            : evalExpr(expr, model);
    }

    /**
     * 计算表达式的值
     *
     * @inner
     * @param {Object} expr 表达式对象
     * @param {Model} model 数据对象
     * @param {Component=} component 组件
     * @return {*}
     */
    function evalExpr(expr, model, component) {
        switch (expr.type) {
            case ExprType.STRING:
            case ExprType.NUMBER:
                if (!expr.value) {
                    expr.value = (new Function('return ' + expr.literal))();
                }
                return expr.value;

            case ExprType.IDENT:
            case ExprType.PROP_ACCESSOR:
                return model.get(expr);

            case ExprType.INTERPOLATION:
                var value = model.get(expr.expr);
                each(expr.filters, function (filter) {
                    var filterFn = component.filters[filter.name.name] || filters[filter.name.name];

                    if (typeof filterFn === 'function') {
                        var args = [value];
                        each(filter.args, function (arg) {
                            args.push(evalExpr(arg, model, component));
                        });

                        value = filterFn.apply(component, args);
                    }
                });

                if (value == null) {
                    value = '';
                }

                return value;

            case ExprType.CALL:
                return;

            case ExprType.TEXT:
                var buf = new StringBuffer();
                each(expr.segs, function (seg) {
                    buf.push(evalExpr(seg, model, component));
                });
                return buf.toString();
        }
    }


    // #region node

    /**
     * 创建节点的工厂方法
     *
     * @inner
     * @param {ANode} aNode 抽象节点
     * @param {Component} owner 节点所属组件
     * @return {Element|TextNode}
     */
    function createNode(aNode, owner) {
        var options = {
            aNode: aNode,
            owner: owner
        };

        if (aNode.isText) {
            return new TextNode(options);
        }

        var ComponentType = owner.components && owner.components[aNode.tagName];
        if (ComponentType) {
            var component = new ComponentType(options);
            return component;
        }

        var ElementType = getElementType(aNode);
        return new ElementType(options);
    }

    function getElementType(aNode) {
        return Element;
    }

    /**
     * 异步执行节点视图更新方法
     *
     * @inner
     * @param {}
     */
    function asyncUpdateMethod(method, node) {
        var args = Array.prototype.slice.call(arguments, 0);
        return function () {
            nextTick(bind.apply(this, args));
        };
    }

    /**
     * 节点生命周期信息
     *
     * @inner
     * @type {Object}
     */
    var LifeCycles = {
        inited: {
            name: 'inited',
            value: 1
        },

        compiled: {
            name: 'compiled',
            value: 2
        },

        created: {
            name: 'created',
            value: 3
        },

        attached: {
            name: 'attached',
            value: 4,
            mutex: 'detached'
        },

        detached: {
            name: 'detached',
            value: 5,
            mutex: 'attached'
        },

        disposed: {
            name: 'disposed',
            value: 6,
            mutex: '*'
        },
    };

    /**
     * 生命周期类
     *
     * @inner
     * @class
     */
    function LifeCycle() {
        this.raw = {};
    }

    /**
     * 设置生命周期
     *
     * @paran {string} name 生命周期名称
     */
    LifeCycle.prototype.set = function (name) {
        var lifeCycle = LifeCycles[name];
        if (!lifeCycle) {
            return;
        }

        if (typeof lifeCycle !== 'object') {
            lifeCycle = {
                value: lifeCycle
            };
        }

        if (lifeCycle.mutex) {
            if (lifeCycle.mutex === '*') {
                this.raw = {};
            }

            delete this.raw[lifeCycle.mutex];
        }

        this.raw[lifeCycle.value] = 1;
    };

    /**
     * 是否位于生命周期
     *
     * @paran {string} name 生命周期名称
     * @return {boolean}
     */
    LifeCycle.prototype.is = function (name) {
        var lifeCycle = LifeCycles[name];
        if (typeof lifeCycle !== 'object') {
            lifeCycle = {
                value: lifeCycle
            };
        }

        return !!this.raw[lifeCycle.value];
    };

    /**
     * 使节点到达相应的生命周期，并调用钩子
     *
     * @inner
     * @param {Element} source 目标节点
     * @param {string} name 生命周期名称
     */
    function callHook(source, name) {
        if (source.lifeCycle.is(name)) {
            return;
        }

        source.lifeCycle.set(name);

        if (typeof source[name] === 'function') {
            source[name].call(source);
        }

        var hookMethod = source.hooks && source.hooks[name];
        if (hookMethod) {
            hookMethod.call(source);
        }
    }

    /**
     * 节点基类
     *
     * @inner
     * @class
     * @param {Object} options 初始化参数
     * @param {ANode} options.aNode 抽象信息节点对象
     * @param {Component=} options.owner 所属的组件对象
     */
    function Node(options) {
        options = options || {};

        this.lifeCycle = new LifeCycle();
        this.init(options);
    }

    /**
     * 初始化
     *
     * @param {Object} options 初始化参数
     */
    Node.prototype.init = function (options) {
        this._init(options);
        callHook(this, 'inited');
    };

    /**
     * 初始化行为
     *
     * @param {Object} options 初始化参数
     */
     Node.prototype._init = function (options) {
        this.owner = options.owner;
        this.aNode = options.aNode || this.aNode || new ANode();
        this.id = this.aNode.id || guid();
    };

    /**
     * 销毁释放元素
     */
    Node.prototype.dispose = function () {
        this._dispose();
        callHook(this, 'disposed');
    };


    /**
     * 文本节点类
     *
     * @inner
     * @class
     * @param {Object} options 初始化参数
     * @param {ANode} options.aNode 抽象信息节点对象
     * @param {Component} options.owner 所属的组件对象
     */
    function TextNode(options) {
        Node.call(this, options);
    }

    inherits(TextNode, Node);

    /**
     * 初始化行为
     *
     * @param {Object} options 初始化参数
     */
    TextNode.prototype._init = function (options) {
        Node.prototype._init.call(this, options);


        this.expr = parseText(this.aNode.text);
        this.update = asyncUpdateMethod(this.update, this);
        var segs = this.expr.segs;

        for (var i = 0, l = segs.length; i < l; i++) {
            var seg = segs[i];
            if (seg.type === ExprType.INTERPOLATION) {
                this.owner.data.onChange(this.update, seg.expr);
            }
        }
    };

    /**
     * 生成文本节点的HTML
     *
     * @return {string}
     */
    TextNode.prototype.genHTML = function () {
        return (evalExpr(this.expr, this.owner.data, this.owner) || ' ')
            + '<script type="text/san-vm" id="' + this.id + '"></script>';
    };

    /**
     * 刷新文本节点的内容
     *
     * @return {string}
     */
    TextNode.prototype.update = function () {
        var node = document.getElementById(this.id).previousSibling;

        if (node) {
            var textProp = typeof node.textContent === 'string' ? 'textContent' : 'innerText';
            node[textProp] = evalExpr(this.expr, this.owner.data, this.owner);
        }
    };

    /**
     * 销毁文本节点
     */
    TextNode.prototype._dispose = function () {
        var segs = this.expr.segs;
        for (var i = 0, l = segs.length; i < l; i++) {
            var seg = segs[i];
            if (seg.type === ExprType.INTERPOLATION) {
                this.owner.data.unChange(seg.expr, this.refreshMethod);
            }
        }

        this.update = null;
        this.aNode = null;
        this.owner = null;
        this.expr = null;
    };



    // #region Element

    /**
     * 元素存储对象
     *
     * @inner
     * @type {Object}
     */
    var elementContainer = {};

    /**
     * 元素类
     *
     * @inner
     * @class
     * @param {Object} options 初始化参数
     * @param {ANode} options.aNode 抽象信息节点对象
     * @param {Component} options.owner 所属的组件对象
     */
    function Element(options) {
        this.childs = [];
        Node.call(this, options);
    }

    inherits(Element, Node);


    /**
     * 初始化行为
     *
     * @param {Object} options 初始化参数
     */
    Element.prototype._init = function (options) {
        Node.prototype._init.call(this, options);

        elementContainer[this.id] = this;
        this.tagName = this.aNode.tagName || 'div';
    };

    /**
     * 创建元素DOM行为
     */
    Element.prototype._create = function () {
        if (!this.el) {
            this.el = document.createElement(this.tagName);
        }
    };

    /**
     * 创建元素DOM
     */
    Element.prototype.create = function () {
        this._create();
        callHook(this, 'created');
    };

    /**
     * 将元素attach到页面
     *
     * @param {HTMLElement} parent 要添加到的父元素
     */
    Element.prototype.attach = function (parent) {
        this.create();

        this.aNode.binds.each(function (bind) {
            if (!this.data) {
                var value = evalExpr(bind.expr, this.owner.data, this.owner);
                this.el.setAttribute(bind.name, value);
            }
        }, this);
        this.el.innerHTML = elementGenChildsHTML(this);
        parent && parent.appendChild(this.el);
        noticeAttached(this);
    };

    /**
     * 通知元素和子元素完成attached状态
     *
     * @inner
     * @param {Element} element 完成attached状态的元素
     */
    function noticeAttached(element) {
        for (var i = 0, l = element.childs ? element.childs.length : 0; i < l; i++) {
            noticeAttached(element.childs[i]);
        }

        callHook(element, 'attached');
    }

    /**
     * 生成元素的html
     *
     * @return {string}
     */
    Element.prototype.genHTML = function () {
        var aNode = this.aNode;
        var buf = new StringBuffer();

        elementGenStartHTML(this, buf);
        buf.push(elementGenChildsHTML(this));
        elementGenCloseHTML(this, buf);

        this.bindDataListener();
        callHook(this, 'created');
        return buf.toString();
    };

    /**
     * 生成元素标签起始的html
     *
     * @inner
     * @param {Element} element 元素
     * @param {StringBuffer} stringBuffer html串存储对象
     */
    function elementGenStartHTML(element, stringBuffer) {
        if (!element.tagName) {
            return;
        }

        stringBuffer.push('<');
        stringBuffer.push(element.tagName);

        // aNode.id = aNode.id || util.guid();

        stringBuffer.push(' id="');
        stringBuffer.push(element.id);
        stringBuffer.push('"');

        element.aNode.binds.each(function (bind) {
            if (!this.data) {
                var value = evalExpr(bind.expr, element.owner.data, element.owner);
                stringBuffer.push(' ');
                stringBuffer.push(bind.name);
                stringBuffer.push('="');
                stringBuffer.push(value);
                stringBuffer.push('"');
            }
        });

        stringBuffer.push('>');
    }

    /**
     * 生成元素标签结束的html
     *
     * @inner
     * @param {Element} element 元素
     * @param {StringBuffer} stringBuffer html串存储对象
     */
    function elementGenCloseHTML(element, stringBuffer) {
        var tagName = element.tagName;
        if (!tagName) {
            return;
        }

        if (!tagIsAutoClose(tagName)) {
            stringBuffer.push('</');
            stringBuffer.push(tagName);
            stringBuffer.push('>');
        }
    }

    /**
     * 生成元素的子元素html
     *
     * @inner
     * @param {Element} element 元素
     * @return {string}
     */
    function elementGenChildsHTML(element) {
        var aNode = element.aNode;

        var buf = new StringBuffer();
        for (var i = 0; i < aNode.childs.length; i++) {
            var child = createNode(aNode.childs[i], element.owner);
            element.childs.push(child);
            buf.push(child.genHTML());
        }

        return buf.toString();
    }

    /**
     * 设置元素属性
     *
     * @param {string} name 属性名称
     * @param {*} name 属性值
     */
    Element.prototype.set = function (name, value) {
        if (!this.el) {
            this.el = document.getElementById(this.id);
        }

        if (this.el && this.lifeCycle.is('created') && !this.blockSetOnce) {
            this.el[name] = value;
            this.blockSetOnce = false;
        }
    };

    /**
     * 绑定数据变化时的试图更新响应行为
     *
     * @inner
     */
    Element.prototype.bindDataListener = function () {
        if (!this.bindListeners) {
            this.bindListeners = [];
            this.aNode.binds.each(bind(bindsIterator, this));
        }

        function bindsIterator(bind) {
            var bindExpr = bind.expr;
            var bindListener;
            if (bindExpr.type === ExprType.TEXT) {
                for (var i = 0, l = bindExpr.segs.length; i < l; i++) {
                    var seg = bindExpr.segs[i];
                    if (seg.type !== ExprType.STRING) {
                        bindListener = {
                            expr: seg.expr,
                            fn: asyncUpdateMethod(this.dataChanger, this, bind.name)
                        };
                        this.bindListeners.push(bindListener);
                        this.owner.data.onChange(bindListener.fn, bindListener.expr);
                    }
                }
            }
            else {
                bindListener = {
                    expr: bindExpr,
                    fn: bind(this.dataChanger, this, bind.name)
                };
                this.bindListeners.push(bindListener);
                this.owner.data.onChange(bindListener.fn, bindListener.expr);
            }
        }
    };

    /**
     * 解除绑定数据变化时的试图更新响应行为
     *
     * @inner
     */
    Element.prototype.unbindDataListener = function () {
        var data = this.owner.data;

        if (this.bindListeners instanceof Array) {
            for (var i = 0, l = this.bindListeners.length; i < l; i++) {
                var listener = this.bindListeners[i];
                data.unChange(listener.expr, listener.fn);
            }

            this.bindListeners.length = 0;
            this.bindListeners = null;
        }
    };

    /**
     * 绑定属性的对应数据变化时的视图更新函数
     *
     * @param {string} name 属性名
     */
    Element.prototype.dataChanger = function (name) {
        var bind = this.aNode.binds.get(name);
        this.set(name, evalExpr(bind.expr, this.owner.data, this));
    };

    /**
     * 将元素从页面上移除
     */
    Element.prototype.detach = function () {
        this._detach();
        callHook(this, 'detached');
    };

    /**
     * 将元素从页面上移除的行为
     */
    Element.prototype._detach = function () {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
    };

    /**
     * 销毁释放元素的行为
     */
    Element.prototype._dispose = function () {
        for (var i = 0, l = this.childs.length; i < l; i++) {
            this.childs[i].dispose();
        }

        this.unbindDataListener();
        this.detach();
        this.model = null;
        this.el = null;
        this.aNode = null;
        this.owner = null;
    };

    // #region Component

    /**
     * 组件类
     *
     * @class
     * @param {Object} options 初始化参数
     */
    function Component(options) {
        Element.call(this, options);
    }

    inherits(Component, Element);

    /**
     * 初始化
     *
     * @param {Object} options 初始化参数
     */
    Component.prototype.init = function (options) {
        this.data = new Model();
        this.filters = options.filters || this.filters || {};
        if (!this.owner) {
            this.owner = this;
        }

        this.aNode = options.aNode || this.aNode;
        this._compile();
        callHook(this, 'compiled');

        Element.prototype._init.call(this, options);
        if (!this.owner) {
            this.owner = this;
        }
        callHook(this, 'inited');

        // 如果从el编译的，认为已经attach了，触发钩子
        if (this.compileFromEl) {
            callHook(this, 'created');
            callHook(this, 'attached');
        }
    };

    /**
     * 模板编译行为
     */
    Component.prototype._compile = function () {
        // TODO: Node基类的init在aNode处理上对component有问题，回头来看看

        if (!this.aNode) {
            if (this.template) {
                this.aNode = parseTemplate(this.template);
            }
            else if (this.el) {
                this.aNode = parseFromDOM(this.el);
                this.compileFromEl = true;
            }
            else {
                this.aNode = new ANode();
            }
        }
    };

    /**
     * 将元素attach到页面的行为
     *
     * @param {HTMLElement} parent 要添加到的父元素
     */
    Component.prototype._attach = function (parent) {
        Element.prototype._attach.call(this, parent);

        for (var i = 0; i < DELEGATE_EVENT.length; i++) {
            var eventName = DELEGATE_EVENT[i];
            on(this.el, eventName, bind(DELEGATE_EVENT_LISTENERS[eventName], this));
        }
    };

    /**
     * 将元素从页面上移除的行为
     */
    Component.prototype._detach = function () {
        for (var i = 0; i < DELEGATE_EVENT.length; i++) {
            var eventName = DELEGATE_EVENT[i];
            un(this.el, eventName, bind(DELEGATE_EVENT_LISTENERS[eventName], this));
        }

        Element.prototype._detach.call(this, parent);
    };

    /**
     * 要代理的DOM事件列表
     *
     * @inner
     * @type {Array}
     */
    var DELEGATE_EVENT = ['click'];

    /**
     * 代理DOM事件的监听器们
     *
     * @inner
     * @type {Object}
     */
    var DELEGATE_EVENT_LISTENERS = {
        click: function (e) {
            var target = e.target;
            var targetElement = elements[target.id];
            var bind = targetElement.aNode.events.get('click');

            if (bind) {
                var bindExpr = bind.expr;

                var args = [];
                for (var i = 0; i < bindExpr.args.length; i++) {
                    var argExpr = bindExpr.args[i];
                    if (argExpr.type === ExprType.IDENT && argExpr.name === '$event') {
                        args.push(e);
                    }
                    else {
                        args.push(evalExpr(argExpr, targetElement.owner.data, targetElement.owner));
                    }
                }

                var method = this[bindExpr.name.name];
                if (typeof method === 'function') {
                    method.apply(this, args);
                }
            }
        }
    };

    /**
     * 设置组件属性
     *
     * @param {string} name 属性名称
     * @param {*} name 属性值
     */
    Component.prototype.set = function (name, value) {
        this.data.set(name, value);
    };

    // #region exports
    var vmExports = {};

    /**
     * 创建组件类
     *
     * @param {Object} proto
     * @return {Function}
     */
    vmExports.Component = function (proto) {
        function YourComponent(options) {
            Component.call(this, options);
        }

        // pre compile template
        if (proto.template) {
            proto.aNode = parseTemplate(proto.template);
            delete proto.template;
        }

        YourComponent.prototype = proto;
        inherits(YourComponent, Component);

        if (proto.tagName) {
            vmExports.register(proto.tagName, YourComponent);
        }

        return YourComponent;
    };

    /**
     * 存储全局 filter 的对象
     *
     * @inner
     * @type {Object}
     */
    var filters = {};

    /**
     * 注册全局 filter
     *
     * @param {string} name 名称
     * @param {function(*, ...*):*} filter 过滤函数
     */
    vmExports.addFilter = function (name, filter) {
        filters[name] = filter;
    };

    /**
     * 存储全局组件的对象
     *
     * @inner
     * @type {Object}
     */
    var ComponentClasses = {};

    /**
     * 注册全局组件
     *
     * @param {string} name 名称
     * @param {Function} ComponentClass 组件类
     */
    vmExports.register = function (name, ComponentClass) {
        ComponentClasses[name] = ComponentClass;
    };

    /**
     * 在下一个更新周期运行函数
     *
     * @param {Function} fn 要运行的函数
     */
    vmExports.nextTick = nextTick;

    // export
    if (typeof exports === 'object' && typeof module === 'object') {
        // For CommonJS
        exports = module.exports = vmExports;
    }
    else if (typeof define === 'function' && define.amd) {
        // For AMD
        define('san-vm', [], vmExports);
        define( [], vmExports);
    }
    else {
        // For <script src="..."
        root.sanVM = vmExports;
    }

})(this);