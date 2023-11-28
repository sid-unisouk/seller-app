import Order from '../../models/order.model';
import Fulfillment from '../../models/fulfillments.model';
import Product from '../../../product/models/product.model';
import ProductCustomization from '../../../product/models/productCustomization.model';
import ReturnItem from '../../models/returnItem.model';
import HttpRequest from '../../../../lib/utils/HttpRequest';
import {mergedEnvironmentConfig} from '../../../../config/env.config';
import {ConflictError} from '../../../../lib/errors';
import MESSAGES from '../../../../lib/utils/messages';
import {RETURN_REASONS} from '../../../../lib/utils/constants';
import BadRequestParameterError from '../../../../lib/errors/bad-request-parameter.error';

class OrderService {
    async create(data) {
        try {
            let query = {};

            console.log('data----->', data);
            console.log('data---items-->', data.data.items);
            // const organizationExist = await Product.findOne({productName:data.productName});
            // if (organizationExist) {
            //     throw new DuplicateRecordFoundError(MESSAGES.PRODUCT_ALREADY_EXISTS);
            // }
            //update item qty in product inventory

            for (let item of data.data.items) {
                let tags = item.tags;
                if (tags && tags.length > 0) {
                    let tagData = tags.find((tag) => {
                        return tag.code === 'type';
                    });
                    let tagTypeData = tagData.list.find((tagType) => {
                        return tagType.code === 'type';
                    });
                    let itemType = tagTypeData.value;
                    if (itemType === 'customization') {
                        if (item.quantity.count) {
                            //reduce item quantity
                            let product = await ProductCustomization.findOne({_id: item.id});
                            product.available = product.available - item.quantity.count;
                            if (product.quantity < 0) {
                                throw new ConflictError();
                            }
                            await product.save();
                        }
                    } else {
                        if (item.quantity.count) {
                            //reduce item quantity
                            let product = await Product.findOne({_id: item.id});

                            console.log({qty: product?.quantity, id: item.id});
                            console.log({qtyCount: item.quantity.count});
                            product.quantity = product.quantity - item.quantity.count;
                            if (product.quantity < 0) {
                                throw new ConflictError();
                            }
                            await product.save();
                        }
                    }
                } else {
                    if (item.quantity.count) {
                        //reduce item quantity
                        let product = await Product.findOne({_id: item.id});

                        console.log({qty: product?.quantity, id: item.id});
                        console.log({qtyCount: item.quantity.count});
                        product.quantity = product.quantity - item.quantity.count;
                        if (product.quantity < 0) {
                            throw new ConflictError();
                        }
                        await product.save();
                    }
                }

            }
            // data.data.organization=data.data.provider.id;
            let order = new Order(data.data);
            let savedOrder = await order.save();

            return savedOrder;
        } catch (err) {
            console.log(`[OrderService] [create] Error in creating product ${data.organizationId}`, err);
            throw err;
        }
    }

    async listReturnRequests(params) {
        try {
            let query = {};
            if (params.organization) {
                query.organization = params.organization;
            }
            const data = await ReturnItem.find(query).populate([{
                path: 'organization',
                select: ['name', '_id', 'storeDetails']
            }]).sort({createdAt: -1}).skip(params.offset * params.limit).limit(params.limit).lean();
            for (const order of data) {
                let item = await Product.findOne({_id: order.itemId}).lean();

                let code = RETURN_REASONS.find((codes) => {
                    return codes.key === order.reason;
                });

                console.log('reason--->', code);
                order.reason = code.value;
                order.item = item;
            }
            const count = await ReturnItem.count(query);
            let orders = {
                count,
                data
            };
            return orders;
        } catch (err) {
            console.log('[OrderService] [getAll] Error in getting all return requests ', err);
            throw err;
        }
    }

    async list(params) {
        try {
            let query = {};
            if (params.organization) {
                query.organization = params.organization;
            }
            const data = await Order.find(query).populate([{
                path: 'organization',
                select: ['name', '_id', 'storeDetails']
            }]).sort({createdAt: -1}).skip(params.offset * params.limit).limit(params.limit).lean();

            for (const order of data) {

                console.log('ordre----->', order);
                console.log('ordre----itemsss->', order.items);
                console.log('ordre----itemsss->0', order.items[0]);

                let items = [];
                for (const itemDetails of order.items) {

                    console.log('ordre----item->', itemDetails);

                    let item = await Product.findOne({_id: itemDetails.id});
                    itemDetails.details = item; //TODO:return images
                    items.push(itemDetails);
                }
                order.items = items;
                console.log('items-----', items);
            }
            console.log('data.items---->', data.items);
            const count = await Order.count(query);
            let orders = {
                count,
                data
            };
            return orders;
        } catch (err) {
            console.log('[OrderService] [getAll] Error in getting all organization ', err);
            throw err;
        }
    }


    async get(orderId) {
        try {
            let order = await Order.findOne({_id: orderId}).lean();

            console.log('order---->', order);
            let items = [];
            for (const itemDetails of order.items) {

                console.log('ordre----item->', itemDetails);

                let item = await Product.findOne({_id: itemDetails.id});
                itemDetails.details = item; //TODO:return images
                items.push(itemDetails);
            }
            order.items = items;

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

    async updateOrderStatus(orderId, data) {
        try {
            let order = await Order.findOne({_id: orderId}).lean();

            //update order state
            order.state = data.status;

            //notify client to update order status ready to ship to logistics
            let httpRequest = new HttpRequest(
                mergedEnvironmentConfig.intraServiceApiEndpoints.client,
                '/api/v2/client/status/updateOrder',
                'PUT',
                {data: order},
                {}
            );
            await httpRequest.send();

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

    async cancelItems(orderId, data) {
        try {
            let order = await Order.findOne({_id: orderId});//.lean();

            //update order item level status

            if (order.items.length === 1) {
                throw new BadRequestParameterError(MESSAGES.SINGLE_ITEM_CANNOT_CANCEL);
            }
            let items = [];
            for (let updateItem of order.items) {
                let item = data.find((i) => {
                    return i.id === updateItem.id;
                });
                if (item) {
                    updateItem.state = 'Cancelled';
                    updateItem.reason_code = item.cancellation_reason_id;
                    items.push(updateItem);
                } else {
                    items.push(updateItem);
                }

            }

            order.items = items;

            await Order.findOneAndUpdate({_id: orderId}, {items: items});

            //notify client to update order status ready to ship to logistics
            let httpRequest = new HttpRequest(
                mergedEnvironmentConfig.intraServiceApiEndpoints.client,
                '/api/client/status/updateOrderItems',
                'PUT',
                {data: order},
                {}
            );
            await httpRequest.send();

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

    async updateReturnItem(orderId, data) {
        try {
            let order = await Order.findOne({orderId: orderId});//.lean();

            let returnRequest = await Fulfillment.findOne({id: data.id, orderId: orderId});
            //update order item level status

            console.log({returnRequest});
            if (data.state === 'Rejected') {

                //https://docs.google.com/spreadsheets/d/1_qAtG6Bu2we3AP6OpXr4GVP3X-32v2xNRNSYQhhR6kA/edit#gid=594583443

                returnRequest.request['@ondc/org/provider_name'] = 'LSP courier 1';
                returnRequest.state = {
                    'descriptor':
                        {
                            'code': 'Return_Rejected',
                            'Short_desc': '001', //HARD coded for now
                        }
                };

                let updatedFulfillment = order.fulfillments.find(x => x.id == data.id);

                updatedFulfillment.state = {
                    'descriptor':
                        {
                            'code': 'Return_Rejected',
                            'Short_desc': '001', //TODO: HARD coded for now
                        }
                };
                updatedFulfillment['@ondc/org/provider_name'] = 'LSP courier 1';
                let foundIndex = order.fulfillments.findIndex(x => x.id == data.id);

                let item = returnRequest.request.tags[0].list.find(x => x.code === 'item_id').value;

                let itemObject = {
                    'id': item,
                    'fulfillment_id': data.id,
                    'quantity':
                        {
                            'count': 0
                        }
                };
                order.items.push(itemObject);

                order.fulfillments[foundIndex] = updatedFulfillment;

                console.log({updatedFulfillment});

            }

            if (data.state === 'Liquidated') {
                returnRequest.request['@ondc/org/provider_name'] = 'LSP courier 1';
                returnRequest.state = {
                    'descriptor':
                        {
                            'code': 'Liquidated'
                        }
                };

                let updatedFulfillment = order.fulfillments.find(x => x.id == data.id);

                updatedFulfillment.state = {
                    'descriptor':
                        {
                            'code': 'Liquidated'
                        }
                };
                updatedFulfillment['@ondc/org/provider_name'] = 'LSP courier 1'; //TODO: hard coded
                let foundIndex = order.fulfillments.findIndex(x => x.id == data.id);

                console.log({updatedFulfillment});
                //1. append item list with this item id and fulfillment id
                let item = returnRequest.request.tags[0].list.find(x => x.code === 'item_id').value;
                let quantity = returnRequest.request.tags[0].list.find(x => x.code === 'item_quantity').value;

                let itemIndex = order.items.findIndex(x => x.id ===item);
                let itemToBeUpdated= order.items.find(x => x.id ===item);
                itemToBeUpdated.quantity.count = itemToBeUpdated.quantity.count - parseInt(quantity);
                order.items[itemIndex] = itemToBeUpdated; //Qoute needs to be updated here.

                //get product price
                let productItem= await Product.findOne({_id:item});

                console.log({productItem});

                let qouteTrail = {
                    'code': 'quote_trail',
                    'list':
                        [
                            {
                                'code': 'title_type',
                                'value': 'item'
                            },
                            {
                                'code': 'id',
                                'value': item
                            },
                            {
                                'code': 'currency',
                                'value': 'INR'
                            },
                            {
                                'code': 'value',
                                'value': '-'+( productItem.MRP*quantity)
                            }
                        ]
                };

                returnRequest.quote_trail = qouteTrail;
                updatedFulfillment.tags =[];
                updatedFulfillment.tags.push(returnRequest.request.tags[0]);
                updatedFulfillment.tags.push(qouteTrail);

                order.fulfillments[foundIndex] = updatedFulfillment;

                let itemObject = {
                    'id': item,
                    'fulfillment_id': data.id,
                    'quantity':
                        {
                            'count': quantity
                        }
                };
                order.items.push(itemObject);

                //2. append qoute trail

            }

            await returnRequest.save();
            await order.save();
            //await Order.findOneAndUpdate({orderId:orderId},{items:items});

            //notify client to update order status ready to ship to logistics
            let httpRequest = new HttpRequest(
                mergedEnvironmentConfig.intraServiceApiEndpoints.client,
                '/api/v2/client/status/updateOrderItems',
                'PUT',
                {data: order},
                {}
            );
            await httpRequest.send();

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

    async cancel(orderId, data) {
        try {
            let order = await Order.findOne({_id: orderId}).lean();

            //update order state
            order.state = 'Cancelled';
            order.cancellation_reason_id = data.cancellation_reason_id;
            order.orderId = order.orderId;

            //notify client to update order status ready to ship to logistics
            let httpRequest = new HttpRequest(
                mergedEnvironmentConfig.intraServiceApiEndpoints.client,
                '/api/client/status/cancel',
                'POST',
                {data: order},
                {}
            );
            await httpRequest.send();

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

    async getONDC(orderId) {
        try {
            let order = await Order.findOne({orderId: orderId}).lean();

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

    async update(orderId, data) {
        try {
            let order = await Order.findOne({orderId: orderId}).lean();

            order.state = data.state;

            await order.save();

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

    async OndcUpdate(orderId, data) {
        try {

            let oldOrder = await Order.findOne({orderId: orderId}).lean();

            console.log('oldOrder--->', orderId, oldOrder);
            delete data.data._id;

            for (let fl of data.data.fulfillments) {

                //create fl if not exist
                let fulfilment = await Fulfillment.findOne({id: fl.id, orderId: orderId});

                if (!fulfilment) { //create new
                    let newFl = new Fulfillment();
                    newFl.id = fl.id;
                    newFl.orderId = orderId;
                    newFl.request = fl;
                    await newFl.save();
                }

                // if(item.state=='Return_Initiated'){ //check if old item state
                //     //reduce item quantity
                //     // let product = await Product.findOne({_id:item.id});
                //     // product.quantity = product.quantity-item.quantity.count;
                //     // if(product.quantity<0){
                //     //     throw new ConflictError();
                //     // }
                //     // await product.save();
                //
                //     //step 1. add item to return model
                //     let returnData = {
                //         itemId: item.id,
                //         orderId:orderId,
                //         state:item.state,
                //         qty:item.quantity.count,
                //         organization:oldOrder.organization,
                //         reason:item.reason_code
                //     };
                //
                //     let returnItem = await ReturnItem.findOne({orderId:orderId,itemId:item.id});
                //     if(!returnItem){
                //         await new ReturnItem(returnData).save();
                //     }
                // }
            }

            let order = await Order.findOneAndUpdate({orderId: orderId}, data.data);

            return order;

        } catch (err) {
            console.log('[OrganizationService] [get] Error in getting organization by id -}', err);
            throw err;
        }
    }

}

export default OrderService;
